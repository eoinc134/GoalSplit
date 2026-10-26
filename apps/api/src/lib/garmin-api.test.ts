import { describe, it, expect } from "vitest";
import { dateChunks, plausibleRestingHr, toGarminDayPoints, tokenSecondsLeft, type GarminDailySummary } from "./garmin-api";

function day(overrides: Partial<GarminDailySummary> = {}): GarminDailySummary {
  return {
    calendarDate: "2026-10-20",
    includesWellnessData: true,
    movement: { steps: { value: 12939 } },
    heartRate: { minValue: 39, maxValue: 161, restingValue: 40 },
    stress: { avgLevel: 15, maxLevel: 96, totalDurationInMillis: 86_280_000 },
    bodyBattery: { minValue: 37, maxValue: 100 },
    ...overrides,
  };
}

describe("dateChunks", () => {
  it("covers the range inclusively in fixed-size chunks", () => {
    expect(dateChunks("2026-01-01", "2026-01-10", 4)).toEqual([
      ["2026-01-01", "2026-01-04"],
      ["2026-01-05", "2026-01-08"],
      ["2026-01-09", "2026-01-10"],
    ]);
    expect(dateChunks("2026-01-01", "2026-01-01", 28)).toEqual([["2026-01-01", "2026-01-01"]]);
  });
});

describe("tokenSecondsLeft", () => {
  it("reads the JWT exp claim", () => {
    const payload = Buffer.from(JSON.stringify({ exp: 2_000 })).toString("base64url");
    expect(tokenSecondsLeft(`h.${payload}.s`, 1_000_000)).toBe(1_000);
    expect(tokenSecondsLeft("not-a-jwt")).toBeNull();
  });
});

describe("plausibleRestingHr", () => {
  it("keeps a resting HR from a fully worn day", () => {
    expect(plausibleRestingHr(day())).toBe(40);
  });

  it("drops it from a briefly worn day, far above the day's minimum, or above 100", () => {
    expect(plausibleRestingHr(day({ stress: { totalDurationInMillis: 1.5 * 3_600_000 } }))).toBeNull();
    expect(plausibleRestingHr(day({ heartRate: { minValue: 101, restingValue: 148 } }))).toBeNull();
    expect(plausibleRestingHr(day({ heartRate: { minValue: 100, restingValue: 105 } }))).toBeNull();
  });
});

describe("toGarminDayPoints", () => {
  it("maps daily summaries, sleep and HRV onto day rows", () => {
    const [p] = toGarminDayPoints(
      [day()],
      [{ calendarDate: "2026-10-20", sleepTimeSeconds: 35_100 }],
      [{ calendarDate: "2026-10-20", lastNightAvg: 52, status: "BALANCED" }],
    );
    expect(p).toMatchObject({
      day: "2026-10-20",
      restingHeartRate: 40,
      minHeartRate: 39,
      maxHeartRate: 161,
      avgStressLevel: 15,
      maxStressLevel: 96,
      bodyBatteryHigh: 100,
      bodyBatteryLow: 37,
      totalSteps: 12939,
      hrvLastNightAvg: 52,
      hrvStatus: "BALANCED",
    });
    expect(p.sleepDurationHours).toBeCloseTo(9.75);
    expect(p.averageHeartRate).toBeNull();
  });

  it("maps sleep stages and local times, Body Battery charge/drain, and stress-band minutes", () => {
    const [p] = toGarminDayPoints(
      [
        day({
          bodyBattery: { minValue: 37, maxValue: 100, chargedValue: 50, drainedValue: 65 },
          stress: {
            avgLevel: 15,
            totalDurationInMillis: 86_280_000,
            restDurationInMillis: 61_920_000,
            lowStressDurationInMillis: 4_920_000,
            mediumStressDurationInMillis: 1_020_000,
            highStressDurationInMillis: 600_000,
          },
        }),
      ],
      [
        {
          calendarDate: "2026-10-20",
          sleepTimeSeconds: 28_680,
          deepSleepSeconds: 0,
          lightSleepSeconds: 15_480,
          remSleepSeconds: 13_200,
          awakeSleepSeconds: 120,
          // 2026-10-19T23:17 and 2026-10-20T07:55 local, encoded as if UTC
          sleepStartTimestampLocal: Date.UTC(2026, 9, 19, 23, 17),
          sleepEndTimestampLocal: Date.UTC(2026, 9, 20, 7, 55),
          averageRespirationValue: 15,
        },
      ],
    );
    expect(p).toMatchObject({
      deepSleepSeconds: 0, // a real zero, not missing
      lightSleepSeconds: 15_480,
      remSleepSeconds: 13_200,
      awakeSleepSeconds: 120,
      sleepStartLocal: "2026-10-19T23:17",
      sleepEndLocal: "2026-10-20T07:55",
      sleepRespirationAvg: 15,
      bodyBatteryCharged: 50,
      bodyBatteryDrained: 65,
      stressRestSeconds: 61_920,
      stressLowSeconds: 4_920,
      stressMediumSeconds: 1_020,
      stressHighSeconds: 600,
    });
  });

  it("treats Garmin's negative 'not enough data' stress values as missing", () => {
    const [p] = toGarminDayPoints([day({ stress: { avgLevel: -1, maxLevel: -2, totalDurationInMillis: 86_000_000 } })], []);
    expect(p.avgStressLevel).toBeNull();
    expect(p.maxStressLevel).toBeNull();
  });

  it("keeps a sleep-only day but skips days with nothing at all", () => {
    const points = toGarminDayPoints(
      [{ calendarDate: "2026-10-21", includesWellnessData: false }],
      [{ calendarDate: "2026-10-22", sleepTimeSeconds: 28_800 }],
    );
    expect(points.map((p) => p.day)).toEqual(["2026-10-22"]);
  });
});
