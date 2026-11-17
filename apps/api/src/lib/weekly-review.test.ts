import { describe, it, expect } from "vitest";
import type { GarminDayPoint, RestingHrBaselinePoint, WeeklyReview, WeeklyReviewWeek } from "@goalsplit/types";
import { formatWeeklyReviewMarkdown, tsbReading, weekRecovery } from "./weekly-review";

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

function rhrPoint(d: string, deviation: number | null, elevated = false): RestingHrBaselinePoint {
  return { day: d, restingHr: 50, baseline: 48, bandLow: 46, bandHigh: 50, deviation, elevated };
}

describe("weekRecovery", () => {
  it("averages the week's Garmin readings and counts elevated mornings", () => {
    const days = [
      day("2026-09-07", { restingHeartRate: 48, sleepDurationHours: 7, bodyBatteryHigh: 80, sleepStartLocal: "2026-09-06T23:30", stressRestSeconds: 3600, stressLowSeconds: 3600 }),
      day("2026-09-08", { restingHeartRate: 52, sleepDurationHours: 8, bodyBatteryHigh: 70, sleepStartLocal: "2026-09-08T00:30" }),
      day("2026-09-09", { sleepStartLocal: "2026-09-09T00:00" }),
    ];
    const r = weekRecovery(days, [rhrPoint("2026-09-07", -1), rhrPoint("2026-09-08", 4, true)]);
    expect(r).toMatchObject({
      daysWithData: 2,
      restingHrMean: 50,
      restingHrDeviationMean: 1.5,
      elevatedRestingHrDays: 1,
      sleepHoursMean: 7.5,
      bodyBatteryHighMean: 75,
      restStressPct: 50,
    });
    // 23:30, 00:30 and 00:00 sit an hour apart, not across midday.
    expect(r.bedtimeSdMinutes).toBeLessThan(40);
  });

  it("returns nulls for a week with no Garmin data", () => {
    expect(weekRecovery([], [])).toEqual({
      daysWithData: 0,
      restingHrMean: null,
      restingHrDeviationMean: null,
      elevatedRestingHrDays: 0,
      sleepHoursMean: null,
      bedtimeSdMinutes: null,
      bodyBatteryHighMean: null,
      restStressPct: null,
    });
  });
});

describe("tsbReading", () => {
  it("uses the Training page's form bands", () => {
    expect(tsbReading(5)).toBe("fresh");
    expect(tsbReading(-5)).toBe("neutral");
    expect(tsbReading(-20)).toBe("productive overload");
    expect(tsbReading(-40)).toBe("deep fatigue");
  });
});

function week(weekStart: string, overrides: Partial<WeeklyReviewWeek> = {}, load = 300): WeeklyReviewWeek {
  return {
    weekStart,
    isPartialWeek: false,
    daysElapsed: 7,
    training: {
      runCount: 4,
      runDistanceM: 40_000,
      activityCount: 4,
      movingTimeS: 4 * 3600,
      load,
      monotony: 1.2,
      strain: 360,
      lowPct: 80,
      moderatePct: 10,
      highPct: 10,
      polarizationIndex: 2.1,
      medianEf: 1.6,
      z2PaceSecPerKm: 330,
      longRun: null,
    },
    recovery: weekRecovery([], []),
    ...overrides,
  };
}

function review(overrides: Partial<WeeklyReview> = {}): WeeklyReview {
  return {
    asOf: "2026-09-09",
    weeks: 3,
    current: { atl: 50, ctl: 45, tsb: -12, acwr: 1.1, band: "sweet-spot", rampRate: 2, load7d: 320, monotony7d: 1.3, strain7d: 416 },
    phase: { start: "2026-07-06", end: "2026-08-31", weeks: 9, mean: 310 },
    weekly: [week("2026-08-24", {}, 280), week("2026-08-31", {}, 340), { ...week("2026-09-07", {}, 120), isPartialWeek: true, daysElapsed: 3 }],
    readiness: null,
    bedtime: null,
    efficiency: { recentMedianEf: 1.62, priorMedianEf: 1.58, efChangePct: 2.5 },
    physiology: { hrMax: 190, hrRest: 50, hrRestSource: "garmin", zoneModel: "karvonen" },
    dataQuality: { insufficientHistory: false, hrCoveragePct7d: 100, streamsCoveragePct: 100, garminLatestDay: "2026-09-09", lastActivityDate: "2026-09-09" },
    ...overrides,
  };
}

describe("formatWeeklyReviewMarkdown", () => {
  it("marks stale readiness and an empty training window", () => {
    const md = formatWeeklyReviewMarkdown(
      review({
        readiness: { day: "2026-08-30", score: 50, label: "Normal", components: [] },
        dataQuality: { ...review().dataQuality, lastActivityDate: "2026-05-02" },
      }),
    );
    expect(md).toContain("on 2026-08-30 (Normal, stale: 10 days old; 50 = your normal)");
    expect(md).toContain("No activities in this window. The last one was on 2026-05-02");
  });

  it("reports current status with interpretation and the partial week", () => {
    const md = formatWeeklyReviewMarkdown(review());
    expect(md).toContain("**Form (TSB)** -12.0: productive overload");
    expect(md).toContain("sweet spot (0.8–1.3)");
    expect(md).toContain("**Current training phase** since 2026-07-06");
    expect(md).toContain("| 2026-09-07 (3/7 days) |");
    expect(md).toContain("The current week has only 3 of 7 days");
  });

  it("compares the last complete week with the ones before, excluding the partial week", () => {
    const md = formatWeeklyReviewMarkdown(review());
    expect(md).toContain("## Last complete week (2026-08-31) vs the 1 before it");
    expect(md).toContain("| TRIMP | 340 | 280 | +60 |");
    expect(md).toContain("| Low-intensity share | 80% | 80% | 0 pts |");
  });

  it("flags missing or stale Garmin data and low coverage", () => {
    const stale = formatWeeklyReviewMarkdown(
      review({ dataQuality: { insufficientHistory: true, hrCoveragePct7d: 40, streamsCoveragePct: 50, garminLatestDay: "2026-09-01", lastActivityDate: "2026-09-09" } }),
    );
    expect(stale).toContain("Garmin data stops at 2026-09-01");
    expect(stale).toContain("Under 42 days of history");
    expect(stale).toContain("Only 40% of the last 7 days' activities have HR");
    expect(formatWeeklyReviewMarkdown(review({ dataQuality: { ...review().dataQuality, garminLatestDay: null } }))).toContain(
      "There's no Garmin data",
    );
  });
});
