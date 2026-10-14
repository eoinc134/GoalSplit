import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../db/index.js", () => ({
  sql: vi.fn(),
  initSchema: vi.fn().mockResolvedValue(undefined),
}));

import { app } from "../app.js";
import { sql } from "../db/index.js";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/garmin/days", () => {
  it("returns an empty array when no user exists", async () => {
    mockSql.mockResolvedValueOnce([]); // users
    const res = await request(app).get("/api/garmin/days");
    expect(res.status).toBe(200);
    expect(res.body.data.days).toEqual([]);
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
      ]);

    const res = await request(app).get("/api/garmin/days?days=30");

    expect(res.status).toBe(200);
    expect(res.body.data.days).toHaveLength(1);
    expect(res.body.data.days[0]).toMatchObject({ day: "2026-06-01", restingHeartRate: 52, hrvStatus: "Balanced" });
  });
});
