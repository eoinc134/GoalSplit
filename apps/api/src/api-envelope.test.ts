import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("./db/index.js", () => ({
  sql: Object.assign(vi.fn(), { json: vi.fn((v: unknown) => v) }),
}));

import { sql } from "./db/index.js";
import { app } from "./app.js";
import { intParam } from "./lib/api-errors.js";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;

// Answers by query text rather than call order: building a SQL fragment is
// itself a (mocked) sql call, so call order isn't query order.
function respond(rows: { users?: unknown[]; count?: unknown[] }) {
  mockSql.mockImplementation((strings: unknown) => {
    const q = Array.isArray(strings) ? strings.join("?") : "";
    if (q.includes("FROM users")) return Promise.resolve(rows.users ?? []);
    if (q.includes("COUNT(*)")) return Promise.resolve(rows.count ?? [{ count: 0 }]);
    return Promise.resolve([]);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mockSql.mockResolvedValue([]);
});

// Every error the API sends has the same shape, whichever layer produced it.
const isErrorBody = (body: unknown, status: number) =>
  expect(body).toEqual({ error: expect.any(String), code: expect.stringMatching(/^[A-Z_]+$/), statusCode: status });

describe("error envelope", () => {
  it("unknown endpoint", async () => {
    const res = await request(app).get("/api/nope");
    isErrorBody(res.body, 404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("missing API key", async () => {
    vi.stubEnv("API_KEY", "k".repeat(40));
    const res = await request(app).get("/api/dashboard/stats");
    isErrorBody(res.body, 401);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  it("malformed JSON body", async () => {
    const res = await request(app).post("/api/prs").set("content-type", "application/json").send("{not json");
    isErrorBody(res.body, 400);
    expect(res.body.code).toBe("BAD_REQUEST");
  });

  it("an action that needs an athlete", async () => {
    const res = await request(app).post("/api/activities/sync");
    isErrorBody(res.body, 401);
    expect(res.body.code).toBe("NOT_CONNECTED");
  });

  it("validation failure, with a message a person can read", async () => {
    mockSql.mockResolvedValueOnce([{ id: "user-1" }]);
    const res = await request(app).post("/api/prs").send({ distanceLabel: "", timeSeconds: 100, achievedDate: "2026-01-01" });
    isErrorBody(res.body, 400);
    expect(res.body).toMatchObject({ code: "VALIDATION_FAILED", error: "Distance must be 1–60 characters" });
  });

  it("missing activity", async () => {
    respond({ users: [{ id: "user-1" }] });
    const res = await request(app).get("/api/activities/nope");
    isErrorBody(res.body, 404);
  });
});

describe("reads with no athlete connected answer with empty data", () => {
  it("activities list", async () => {
    const res = await request(app).get("/api/activities");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [], total: 0 });
  });

  it("sync status", async () => {
    const res = await request(app).get("/api/sync/status");
    expect(res.status).toBe(200);
    expect(res.body.data.strava).toMatchObject({ running: false, last: null, recent: [], pendingEnrichment: 0 });
  });
});

describe("activity list", () => {
  it("never selects every column, and survives junk paging parameters", async () => {
    respond({ users: [{ id: "user-1" }], count: [{ count: 0 }] });
    const res = await request(app).get("/api/activities?limit=abc&offset=-5");
    expect(res.status).toBe(200);
    const listQuery = mockSql.mock.calls.find(([s]) => Array.isArray(s) && s.join("?").includes("ORDER BY start_date DESC"));
    expect(listQuery?.[0].join("?")).not.toContain("SELECT *");
    expect(listQuery).toContain(50); // default limit, not NaN
    expect(listQuery).toContain(0); // offset clamped
  });
});

describe("intParam", () => {
  it("clamps, and falls back on anything unparseable", () => {
    expect(intParam("30", 50, 1, 200)).toBe(30);
    expect(intParam("999", 50, 1, 200)).toBe(200);
    expect(intParam("0", 50, 1, 200)).toBe(1);
    expect(intParam("abc", 50, 1, 200)).toBe(50);
    expect(intParam(undefined, 50, 1, 200)).toBe(50);
    expect(intParam(["1", "2"], 50, 1, 200)).toBe(50);
  });
});
