import { describe, it, expect } from "vitest";
import type { GarminDayPoint } from "@goalsplit/types";
import { latestValue } from "./garmin";

function day(d: string, overrides: Partial<GarminDayPoint> = {}): GarminDayPoint {
  return {
    day: d,
    restingHeartRate: null,
    maxHeartRate: null,
    minHeartRate: null,
    averageHeartRate: null,
    avgStressLevel: null,
    maxStressLevel: null,
    bodyBatteryHigh: null,
    bodyBatteryLow: null,
    sleepDurationHours: null,
    trainingReadinessScore: null,
    trainingReadinessLevel: null,
    hrvLastNightAvg: null,
    hrvStatus: null,
    totalSteps: null,
    deepSleepSeconds: null,
    lightSleepSeconds: null,
    remSleepSeconds: null,
    awakeSleepSeconds: null,
    sleepStartLocal: null,
    sleepEndLocal: null,
    sleepRespirationAvg: null,
    bodyBatteryCharged: null,
    bodyBatteryDrained: null,
    stressRestSeconds: null,
    stressLowSeconds: null,
    stressMediumSeconds: null,
    stressHighSeconds: null,
    ...overrides,
  };
}

describe("latestValue", () => {
  it("skips a partial newest day and returns the most recent day that has the metric", () => {
    const days = [day("2026-10-23", { restingHeartRate: 48 }), day("2026-10-24", { restingHeartRate: 46 }), day("2026-10-25")];
    expect(latestValue(days, "restingHeartRate")).toEqual({ value: 46, day: "2026-10-24" });
  });

  it("returns null when no day has the metric", () => {
    expect(latestValue([day("2026-10-25")], "hrvLastNightAvg")).toBeNull();
  });

  it("treats zero as a real value", () => {
    expect(latestValue([day("2026-10-25", { avgStressLevel: 0 })], "avgStressLevel")).toEqual({ value: 0, day: "2026-10-25" });
  });
});
