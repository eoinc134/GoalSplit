import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../db/index.js", () => ({
  sql: vi.fn(),
  initSchema: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/garmin-api.service.js", () => ({
  garminConfigured: vi.fn(),
  defaultSyncRange: vi.fn(),
  syncGarmin: vi.fn(),
}));

import { app } from "../app.js";
import { sql } from "../db/index.js";
import { defaultSyncRange, garminConfigured, syncGarmin } from "../services/garmin-api.service.js";

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
    expect(syncGarmin).not.toHaveBeenCalled();
  });

  it("syncs the default range (full history first, then the last week)", async () => {
    mockSql.mockResolvedValueOnce([{ id: "user-1" }]); // users
    vi.mocked(garminConfigured).mockReturnValue(true);
    vi.mocked(defaultSyncRange).mockResolvedValue({ start: "2024-02-06", end: "2026-10-24" });
    vi.mocked(syncGarmin).mockResolvedValue({ synced: 643 });

    const res = await request(app).post("/api/garmin/sync");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ synced: 643, start: "2024-02-06", end: "2026-10-24" });
    expect(syncGarmin).toHaveBeenCalledWith("user-1", "2024-02-06", "2026-10-24");
  });

  it("honours ?days and ignores a non-numeric value", async () => {
    vi.mocked(garminConfigured).mockReturnValue(true);
    vi.mocked(syncGarmin).mockResolvedValue({ synced: 3 });
    vi.mocked(defaultSyncRange).mockResolvedValue({ start: "2026-10-18", end: "2026-10-24" });

    mockSql.mockResolvedValueOnce([{ id: "user-1" }]);
    await request(app).post("/api/garmin/sync?days=3");
    const [, start, end] = vi.mocked(syncGarmin).mock.calls[0];
    expect((Date.parse(end) - Date.parse(start)) / 86_400_000).toBe(2);

    mockSql.mockResolvedValueOnce([{ id: "user-1" }]);
    await request(app).post("/api/garmin/sync?days=abc");
    expect(defaultSyncRange).toHaveBeenCalledTimes(1);
  });

  it("explains a rejected (e.g. expired) key", async () => {
    mockSql.mockResolvedValueOnce([{ id: "user-1" }]);
    vi.mocked(garminConfigured).mockReturnValue(true);
    vi.mocked(defaultSyncRange).mockResolvedValue({ start: "2026-10-18", end: "2026-10-24" });
    vi.mocked(syncGarmin).mockRejectedValue(new Error("GARMIN_KEY_REJECTED"));
    const res = await request(app).post("/api/garmin/sync");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/expired/);
  });
});
