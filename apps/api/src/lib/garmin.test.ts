import { describe, it, expect } from "vitest";
import { toGarminDayPoint, type GarminDayRow } from "./garmin";

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
    deep_sleep_seconds: 3600,
    light_sleep_seconds: 14400,
    rem_sleep_seconds: 7200,
    awake_sleep_seconds: 1800,
    sleep_start_local: "2026-05-31T23:30",
    sleep_end_local: "2026-06-01T07:30",
    sleep_respiration_avg: 14,
    body_battery_charged: 60,
    body_battery_drained: 55,
    stress_rest_seconds: 50_000,
    stress_low_seconds: 8_000,
    stress_medium_seconds: 2_000,
    stress_high_seconds: 500,
    ...overrides,
  };
}

describe("toGarminDayPoint", () => {
  it("maps snake_case database columns to camelCase fields", () => {
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
      deepSleepSeconds: 3600,
      lightSleepSeconds: 14400,
      remSleepSeconds: 7200,
      awakeSleepSeconds: 1800,
      sleepStartLocal: "2026-05-31T23:30",
      sleepEndLocal: "2026-06-01T07:30",
      sleepRespirationAvg: 14,
      bodyBatteryCharged: 60,
      bodyBatteryDrained: 55,
      stressRestSeconds: 50_000,
      stressLowSeconds: 8_000,
      stressMediumSeconds: 2_000,
      stressHighSeconds: 500,
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
