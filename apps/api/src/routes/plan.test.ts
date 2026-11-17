import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../db/index.js", () => ({ sql: vi.fn() }));
vi.mock("../services/analytics-data.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/analytics-data.service.js")>();
  return { ...actual, getPhysiology: vi.fn(), loadAnalyticsActivities: vi.fn() };
});
vi.mock("../services/user.service.js", () => ({ getCurrentUserId: vi.fn() }));

import { app } from "../app.js";
import { sql } from "../db/index.js";
import { getPhysiology, loadAnalyticsActivities, physiologyFrom } from "../services/analytics-data.service.js";
import { getCurrentUserId } from "../services/user.service.js";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;
const mockUserId = vi.mocked(getCurrentUserId);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/plan/adherence", () => {
  it("returns null data with no athlete", async () => {
    mockUserId.mockResolvedValue(null);
    const res = await request(app).get("/api/plan/adherence");
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it("returns the study's criteria, as JSON or markdown", async () => {
    mockUserId.mockResolvedValue("user-1");
    vi.mocked(getPhysiology).mockResolvedValue(physiologyFrom({ activityMaxHr: 190, garminMaxHr: null, restingMedian: 50, sex: "M" }));
    vi.mocked(loadAnalyticsActivities).mockResolvedValue({ today: "2026-11-18", firstActivityDate: null, activities: [], metricsPending: 0 });

    const json = await request(app).get("/api/plan/adherence");
    expect(json.body.data).toMatchObject({ status: "in-progress", weekNumber: 2, requiredMin: 6 });
    expect(json.body.data.criteria).toHaveLength(7);
    expect(json.body.data.weeks).toHaveLength(13);

    const md = await request(app).get("/api/plan/adherence?format=markdown");
    expect(md.type).toBe("text/markdown");
    expect(md.text).toContain("Now in week 2.");
  });
});

describe("/api/plan/notes", () => {
  const row = { week_start: "2026-11-09", body: "Good week.", source: "claude", created_at: new Date("2026-11-17T20:00:00Z"), updated_at: new Date("2026-11-17T20:00:00Z") };

  it("lists notes newest first", async () => {
    mockUserId.mockResolvedValue("user-1");
    mockSql.mockResolvedValueOnce([row]);
    const res = await request(app).get("/api/plan/notes?limit=2");
    expect(res.body.data).toEqual([
      { weekStart: "2026-11-09", body: "Good week.", source: "claude", createdAt: "2026-11-17T20:00:00.000Z", updatedAt: "2026-11-17T20:00:00.000Z" },
    ]);
  });

  it("upserts a note for a Monday", async () => {
    mockUserId.mockResolvedValue("user-1");
    mockSql.mockResolvedValueOnce([row]);
    const res = await request(app).put("/api/plan/notes/2026-11-09").send({ body: "  Good week.  " });
    expect(res.status).toBe(200);
    expect(res.body.data.weekStart).toBe("2026-11-09");
    expect(mockSql).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-Monday, an empty body and an oversized body", async () => {
    mockUserId.mockResolvedValue("user-1");
    expect((await request(app).put("/api/plan/notes/2026-11-10").send({ body: "x" })).status).toBe(400);
    expect((await request(app).put("/api/plan/notes/not-a-date").send({ body: "x" })).status).toBe(400);
    expect((await request(app).put("/api/plan/notes/2026-11-09").send({ body: "   " })).status).toBe(400);
    const big = await request(app).put("/api/plan/notes/2026-11-09").send({ body: "x".repeat(8001) });
    expect(big.body).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("needs a connected athlete to save", async () => {
    mockUserId.mockResolvedValue(null);
    const res = await request(app).put("/api/plan/notes/2026-11-09").send({ body: "x" });
    expect(res.status).toBe(401);
  });
});
