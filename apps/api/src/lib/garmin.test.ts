import { describe, it, expect } from "vitest";
import { toGarminDayPoint, validateGarminConfig, type GarminDayRow } from "./garmin";

function makeRow(overrides: Partial<GarminDayRow> = {}): GarminDayRow {
  return {
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
    ...overrides,
  };
}

describe("toGarminDayPoint", () => {
  it("maps snake_case SQLite columns to camelCase fields", () => {
    const point = toGarminDayPoint(makeRow());
    expect(point).toEqual({
      day: "2026-06-01",
      restingHeartRate: 52,
      maxHeartRate: 178,
      minHeartRate: 48,
      averageHeartRate: 68,
      avgStressLevel: 24,
      maxStressLevel: 61,
      bodyBatteryHigh: 95,
      bodyBatteryLow: 18,
      sleepDurationHours: 7.5,
      trainingReadinessScore: 72,
      trainingReadinessLevel: "Moderate",
      hrvLastNightAvg: 45.2,
      hrvStatus: "Balanced",
      totalSteps: 8421,
    });
  });

  it("passes through nulls for ungathered metrics rather than defaulting them", () => {
    const point = toGarminDayPoint(
      makeRow({ hrv_last_night_avg: null, hrv_status: null, training_readiness_score: null }),
    );
    expect(point.hrvLastNightAvg).toBeNull();
    expect(point.hrvStatus).toBeNull();
    expect(point.trainingReadinessScore).toBeNull();
  });
});

describe("validateGarminConfig", () => {
  it("returns null when any required env var is missing", () => {
    expect(validateGarminConfig({})).toBeNull();
    expect(validateGarminConfig({ GARMIN_EMAIL: "a@b.com" })).toBeNull();
    expect(validateGarminConfig({ GARMIN_EMAIL: "a@b.com", GARMIN_PASSWORD: "x" })).toBeNull();
  });

  it("returns the config when all three env vars are present", () => {
    const config = validateGarminConfig({
      GARMIN_EMAIL: "a@b.com",
      GARMIN_PASSWORD: "x",
      GARMY_DB_PATH: "./health.db",
    });
    expect(config).toEqual({ email: "a@b.com", password: "x", dbPath: "./health.db" });
  });
});
