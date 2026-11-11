import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../db/index.js", () => ({
  sql: vi.fn(),
}));

vi.mock("../services/garmin-api.service.js", () => ({
  garminConfigured: vi.fn(),
  runGarminSync: vi.fn(),
}));

import { app } from "../app.js";
import { sql } from "../db/index.js";
import { garminConfigured, runGarminSync } from "../services/garmin-api.service.js";
import { SyncInProgressError } from "../services/sync-runs.service.js";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/garmin/days", () => {
  it("returns an empty array when no user exists", async () => {
    mockSql.mockResolvedValueOnce([]); // users
    const res = await request(app).get("/api/garmin/days");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ days: [], latestDay: null, lastSyncedAt: null });
  });

  it("returns mapped day points for the user", async () => {
    mockSql
      .mockResolvedValueOnce([{ id: "user-1" }]) // users
      .mockResolvedValueOnce([
        {
          metric_date: "2026-06-01",
          resting_heart_rate: 52,
          max_heart_rate: 178,
          min_heart_rate: 48,
          average_heart_rate: 68,
          avg_stress_level: 24,
          max_stress_level: 61,
          body_battery_high: 95,
          body_battery_low: 18,
          sleep_duration_hours: 7.5,
          training_readiness_score: 72,
          training_readiness_level: "Moderate",
          hrv_last_night_avg: 45.2,
          hrv_status: "Balanced",
          total_steps: 8421,
        },
      ])
      .mockResolvedValueOnce([{ latest_day: "2026-06-01", last_synced_at: new Date("2026-06-02T08:00:00Z") }]); // freshness

    const res = await request(app).get("/api/garmin/days?days=30");

    expect(res.status).toBe(200);
    expect(res.body.data.days).toHaveLength(1);
    expect(res.body.data.days[0]).toMatchObject({ day: "2026-06-01", restingHeartRate: 52, hrvStatus: "Balanced" });
    expect(res.body.data).toMatchObject({ latestDay: "2026-06-01", lastSyncedAt: "2026-06-02T08:00:00.000Z" });
  });
});

describe("POST /api/garmin/sync", () => {
  it("returns 412 when no Garmin API key is configured", async () => {
    mockSql.mockResolvedValueOnce([{ id: "user-1" }]); // users
    vi.mocked(garminConfigured).mockReturnValue(false);
    const res = await request(app).post("/api/garmin/sync");
    expect(res.status).toBe(412);
    expect(runGarminSync).not.toHaveBeenCalled();
  });

  it("runs the default plan and returns its range", async () => {
    mockSql.mockResolvedValueOnce([{ id: "user-1" }]); // users
    vi.mocked(garminConfigured).mockReturnValue(true);
    const result = { synced: 643, start: "2024-02-06", end: "2026-10-24", mode: "backfill" };
    vi.mocked(runGarminSync).mockResolvedValue(result);

    const res = await request(app).post("/api/garmin/sync");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(result);
    expect(runGarminSync).toHaveBeenCalledWith("user-1", { days: null, trigger: "manual" });
  });

  it("honours ?days and ignores a non-numeric value", async () => {
    vi.mocked(garminConfigured).mockReturnValue(true);
    vi.mocked(runGarminSync).mockResolvedValue({ synced: 3, start: "x", end: "y", mode: "range" });

    mockSql.mockResolvedValueOnce([{ id: "user-1" }]);
    await request(app).post("/api/garmin/sync?days=3");
    mockSql.mockResolvedValueOnce([{ id: "user-1" }]);
    await request(app).post("/api/garmin/sync?days=abc");

    expect(vi.mocked(runGarminSync).mock.calls.map(([, o]) => o.days)).toEqual([3, null]);
  });

  it("explains a rejected (e.g. expired) key", async () => {
    mockSql.mockResolvedValueOnce([{ id: "user-1" }]);
    vi.mocked(garminConfigured).mockReturnValue(true);
    vi.mocked(runGarminSync).mockRejectedValue(new Error("GARMIN_KEY_REJECTED"));
    const res = await request(app).post("/api/garmin/sync");
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: "GARMIN_KEY_REJECTED" });
    expect(res.body.error).toMatch(/expired/);
  });

  it("refuses a second sync while one is running", async () => {
    mockSql.mockResolvedValueOnce([{ id: "user-1" }]);
    vi.mocked(garminConfigured).mockReturnValue(true);
    vi.mocked(runGarminSync).mockRejectedValue(new SyncInProgressError("garmin"));
    const res = await request(app).post("/api/garmin/sync");
    expect(res.status).toBe(409);
  });

  it("doesn't leak unexpected error text", async () => {
    mockSql.mockResolvedValueOnce([{ id: "user-1" }]);
    vi.mocked(garminConfigured).mockReturnValue(true);
    vi.mocked(runGarminSync).mockRejectedValue(new Error("connection to postgres://secret failed"));
    const res = await request(app).post("/api/garmin/sync");
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain("secret");
  });
});
