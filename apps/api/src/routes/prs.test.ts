import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../db/index.js", () => ({
  sql: vi.fn(),
  initSchema: vi.fn().mockResolvedValue(undefined),
}));

import { app } from "../app.js";
import { sql } from "../db/index.js";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;

function deleteResult(count: number) {
  return Object.assign([], { count });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/prs", () => {
  it("returns empty records when no user exists", async () => {
    mockSql.mockResolvedValueOnce([]); // users
    const res = await request(app).get("/api/prs");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ records: [], manualEntries: [] });
  });

  it("merges Strava-derived bests with manual entries", async () => {
    mockSql
      .mockResolvedValueOnce([{ id: "user-1" }]) // users
      .mockResolvedValueOnce([{ id: "act-1", strava_id: 1, name: "Morning Run", local_date: "2026-06-01" }]) // activities
      .mockResolvedValueOnce([{ activity_id: "act-1", best_efforts: [{ name: "5K", elapsed_time: 1150 }] }]) // detail dumps
      .mockResolvedValueOnce([
        {
          id: "m-1",
          distance_label: "10K",
          time_seconds: 2400,
          achieved_date: "2026-01-01",
          notes: null,
          source_activity_id: null,
          source_activity_name: null,
          created_at: "2026-01-01T00:00:00Z",
        },
      ]); // manual entries

    const res = await request(app).get("/api/prs");

    expect(res.status).toBe(200);
    expect(res.body.data.manualEntries).toHaveLength(1);
    const distances = res.body.data.records.map((r: { distanceLabel: string }) => r.distanceLabel);
    expect(distances).toEqual(expect.arrayContaining(["5K", "10K"]));
  });

  it("skips the dump lookup entirely when there are no activities", async () => {
    mockSql
      .mockResolvedValueOnce([{ id: "user-1" }]) // users
      .mockResolvedValueOnce([]) // activities
      .mockResolvedValueOnce([]); // manual entries

    const res = await request(app).get("/api/prs");

    expect(res.status).toBe(200);
    expect(mockSql).toHaveBeenCalledTimes(3);
  });
});

describe("POST /api/prs", () => {
  it("rejects an invalid body before touching the database", async () => {
    const res = await request(app).post("/api/prs").send({ distanceLabel: "", timeSeconds: 0, achievedDate: "bad" });
    expect(res.status).toBe(400);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("returns 401 when Strava isn't connected", async () => {
    mockSql.mockResolvedValueOnce([]); // users
    const res = await request(app)
      .post("/api/prs")
      .send({ distanceLabel: "10K", timeSeconds: 2400, achievedDate: "2026-01-01" });
    expect(res.status).toBe(401);
  });

  it("rejects a sourceActivityId that doesn't exist or isn't the user's", async () => {
    mockSql
      .mockResolvedValueOnce([{ id: "user-1" }]) // users
      .mockResolvedValueOnce([]); // ownership check — not found

    const res = await request(app)
      .post("/api/prs")
      .send({ distanceLabel: "10K", timeSeconds: 2400, achievedDate: "2026-01-01", sourceActivityId: "not-mine" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sourceActivityId/);
  });

  it("creates a manual entry with a valid sourceActivityId", async () => {
    mockSql
      .mockResolvedValueOnce([{ id: "user-1" }]) // users
      .mockResolvedValueOnce([{ id: "act-1" }]) // ownership check — found
      .mockResolvedValueOnce([
        {
          id: "m-new",
          distance_label: "10K",
          time_seconds: 2350,
          achieved_date: "2026-01-01",
          notes: null,
          source_activity_id: "act-1",
          source_activity_name: null,
          created_at: "2026-01-01T00:00:00Z",
        },
      ]) // insert ... returning
      .mockResolvedValueOnce([{ name: "Evening 10K attempt" }]); // resolve activity name

    const res = await request(app).post("/api/prs").send({
      distanceLabel: "10K",
      timeSeconds: 2350,
      achievedDate: "2026-01-01",
      sourceActivityId: "act-1",
    });

    expect(res.status).toBe(201);
    expect(res.body.data.sourceActivityName).toBe("Evening 10K attempt");
  });

  it("creates a manual entry with no sourceActivityId", async () => {
    mockSql
      .mockResolvedValueOnce([{ id: "user-1" }]) // users
      .mockResolvedValueOnce([
        {
          id: "m-new",
          distance_label: "8K Turkey Trot",
          time_seconds: 1900,
          achieved_date: "2020-11-26",
          notes: "pre-Strava race",
          source_activity_id: null,
          source_activity_name: null,
          created_at: "2026-01-01T00:00:00Z",
        },
      ]); // insert ... returning

    const res = await request(app).post("/api/prs").send({
      distanceLabel: "8K Turkey Trot",
      timeSeconds: 1900,
      achievedDate: "2020-11-26",
      notes: "pre-Strava race",
    });

    expect(res.status).toBe(201);
    expect(res.body.data.sourceActivityName).toBeNull();
    expect(mockSql).toHaveBeenCalledTimes(2); // no ownership check, no name resolution
  });
});

describe("DELETE /api/prs/:id", () => {
  it("returns 404 when no user exists", async () => {
    mockSql.mockResolvedValueOnce([]); // users
    const res = await request(app).delete("/api/prs/m-1");
    expect(res.status).toBe(404);
  });

  it("deletes a manual entry the user owns", async () => {
    mockSql.mockResolvedValueOnce([{ id: "user-1" }]).mockResolvedValueOnce(deleteResult(1));
    const res = await request(app).delete("/api/prs/m-1");
    expect(res.status).toBe(204);
  });

  it("returns 404 when the entry doesn't exist or isn't the user's", async () => {
    mockSql.mockResolvedValueOnce([{ id: "user-1" }]).mockResolvedValueOnce(deleteResult(0));
    const res = await request(app).delete("/api/prs/not-mine");
    expect(res.status).toBe(404);
  });
});
