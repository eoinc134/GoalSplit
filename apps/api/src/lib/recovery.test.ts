import { describe, it, expect } from "vitest";
import type { DailyLoadPoint, GarminDayPoint } from "@goalsplit/types";
import { bedtimeConsistency, meanWithCi, nextMorningResponse, readiness, restingHrBaseline } from "./recovery";
import { addDaysUtc } from "./dates";
import { noise } from "./__fixtures__/noise";

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

const START = "2026-09-01";
const series = (n: number, f: (i: number, d: string) => Partial<GarminDayPoint>) =>
  Array.from({ length: n }, (_, i) => {
    const d = addDaysUtc(START, i);
    return day(d, f(i, d));
  });

describe("restingHrBaseline", () => {
  it("needs 7 prior days before giving a baseline", () => {
    const pts = restingHrBaseline(series(8, (i) => ({ restingHeartRate: 45 + (i % 2) })));
    expect(pts[6].baseline).toBeNull();
    expect(pts[7].baseline).toBeCloseTo(45.43, 1);
  });

  it("flags a morning far above the 28-day norm, but not ordinary wobble", () => {
    const days = series(30, (i) => ({ restingHeartRate: i === 29 ? 55 : Math.round(45 + noise(i, 1.5)) }));
    const pts = restingHrBaseline(days);
    expect(pts[29].elevated).toBe(true);
    expect(pts[29].deviation!).toBeGreaterThan(8);
    expect(pts.slice(7, 29).some((p) => p.elevated)).toBe(false);
  });
});

describe("bedtimeConsistency", () => {
  it("averages bedtimes across midnight correctly", () => {
    const days = series(6, (i, d) => ({
      sleepStartLocal: `${addDaysUtc(d, -1)}T${i % 2 ? "23:30" : "00:30"}`.replace(/T00:30$/, "T00:30"),
      sleepEndLocal: `${d}T07:30`,
    }));
    // 23:30 and 00:30 alternate → mean midnight, not midday
    const b = bedtimeConsistency(days, addDaysUtc(START, 5))!;
    expect(b.meanBedtime).toBe("00:00");
    expect(b.meanWake).toBe("07:30");
    expect(b.sdMinutes).toBe(30);
  });

  it("needs at least 5 nights", () => {
    expect(bedtimeConsistency(series(3, (_, d) => ({ sleepStartLocal: `${d}T23:00`, sleepEndLocal: `${d}T07:00` })), START)).toBeNull();
  });
});

describe("meanWithCi", () => {
  it("gives a 95% normal-approximation interval", () => {
    const ci = meanWithCi([1, 2, 3, 4, 5])!;
    expect(ci.mean).toBe(3);
    expect(ci.ciHigh - ci.mean).toBeCloseTo((1.96 * Math.sqrt(2.5)) / Math.sqrt(5), 6);
    expect(meanWithCi([1])).toBeNull();
  });
});

function load(d: string, value: number, tsb = 0): DailyLoadPoint {
  return { date: d, load: value, activityCount: value > 0 ? 1 : 0, scoredCount: value > 0 ? 1 : 0, atl: 0, ctl: 0, tsb, acwr: null };
}

describe("nextMorningResponse", () => {
  it("groups days by their own load thirds and summarises the following morning", () => {
    // Cycle rest / easy / moderate / hard; resting HR is 3 bpm higher after hard days.
    const n = 80;
    const loads = Array.from({ length: n }, (_, i) => load(addDaysUtc(START, i), [0, 40, 100, 200][i % 4]));
    const garmin = series(n, (i) => {
      const prevHard = i > 0 && (i - 1) % 4 === 3;
      return { restingHeartRate: prevHard ? 48 : 45, sleepDurationHours: 8 };
    });
    const groups = nextMorningResponse(loads, garmin, restingHrBaseline(garmin));
    const hard = groups.find((g) => g.group === "hard")!;
    const rest = groups.find((g) => g.group === "rest")!;
    expect(hard.loadRange).toEqual([200, 200]);
    expect(groups.find((g) => g.group === "easy")!.loadRange).toEqual([40, 40]);
    expect(hard.days).toBeGreaterThanOrEqual(19);
    expect(hard.restingHrDeviation!.mean).toBeGreaterThan(rest.restingHrDeviation!.mean + 2);
    expect(hard.sleepHours!.mean).toBe(8);
  });
});

describe("readiness", () => {
  it("scores a good morning above 50 and shows its components", () => {
    const n = 40;
    const garmin = series(n, (i) =>
      i === n - 1
        ? { restingHeartRate: 41, sleepDurationHours: 9, bodyBatteryHigh: 100 }
        : { restingHeartRate: Math.round(46 + noise(i, 1.5)), sleepDurationHours: 7 + noise(i + 7, 0.5), bodyBatteryHigh: Math.round(80 + noise(i + 3, 6)) },
    );
    const daily = Array.from({ length: n }, (_, i) => load(addDaysUtc(START, i), 50, noise(i, 5)));
    const r = readiness(garmin, restingHrBaseline(garmin), daily)!;
    expect(r.day).toBe(addDaysUtc(START, n - 1));
    expect(r.score).toBeGreaterThan(60);
    expect(r.label).toBe("Above your normal");
    expect(r.components.map((c) => c.key).sort()).toEqual(["bodyBattery", "form", "restingHr", "sleep"]);
    expect(r.components.find((c) => c.key === "restingHr")!.z).toBeGreaterThan(0); // lower HR = positive
  });

  it("returns null with fewer than two usable components", () => {
    const garmin = series(3, () => ({ restingHeartRate: 45 }));
    expect(readiness(garmin, restingHrBaseline(garmin), [])).toBeNull();
  });
});
