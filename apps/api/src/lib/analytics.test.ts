import { describe, it, expect } from "vitest";
import { computeActivityMetrics, type ActivityMetrics } from "./activity-metrics";
import type { AnalyticsActivity } from "./analytics-activity";
import { buildZoneBoundariesKarvonen } from "./hr-zones";
import { classifyRun } from "./run-classification";
import { polarizationIndex, summarizeIntensity, zoneMinutesFromHistogram } from "./intensity";
import { buildEfficiencySummary, fitTemperatureModel } from "./efficiency";
import { buildLongRunSummary, isLongRunActivity } from "./long-runs";
import { median, ols } from "./stats";
import { addDaysUtc } from "./dates";
import { syntheticStreams, type SyntheticStreamOptions } from "./__fixtures__/streams";

// Karvonen 190/50: Z2 134–147, Z3 148–161, Z4 162–175, Z5 176+
const ZONES = buildZoneBoundariesKarvonen(190, 50);
const TODAY = "2026-09-09";

function metricsFor(o: SyntheticStreamOptions): ActivityMetrics {
  return computeActivityMetrics(syntheticStreams(o), { isRun: true, summaryDistanceM: 0 })!;
}

function run(overrides: Partial<AnalyticsActivity> & { stream?: SyntheticStreamOptions }): AnalyticsActivity {
  const { stream, ...rest } = overrides;
  const metrics = stream ? metricsFor(stream) : null;
  return {
    id: rest.id ?? "act",
    name: "Run",
    type: "Run",
    localDate: TODAY,
    movingTimeS: stream?.seconds ?? 3600,
    distanceM: metrics?.distanceM ?? 10_000,
    elevationGainM: 0,
    averageHeartrate: null,
    workoutType: null,
    isWeekLongest: false,
    metrics,
    ...rest,
  };
}

describe("stats", () => {
  it("computes medians", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });

  it("recovers exact OLS coefficients from noiseless data", () => {
    const xs = [[1, 5], [2, 3], [3, 8], [4, 1], [5, 6]];
    const ys = xs.map(([a, b]) => 2 + 0.5 * a - 0.25 * b);
    const fit = ols(xs, ys)!;
    expect(fit.coefficients[0]).toBeCloseTo(2);
    expect(fit.coefficients[1]).toBeCloseTo(0.5);
    expect(fit.coefficients[2]).toBeCloseTo(-0.25);
    expect(fit.r2).toBeCloseTo(1);
  });

  it("returns null for collinear predictors", () => {
    expect(ols([[1, 2], [2, 4], [3, 6], [4, 8]], [1, 2, 3, 4])).toBeNull();
  });
});

describe("classifyRun", () => {
  const base = {
    workoutType: null,
    distanceM: 10_000,
    elevationGainM: 0,
    isWeekLongest: false,
    averageHeartrate: null,
    zones: ZONES,
  };

  it("trusts the athlete's Strava tag first", () => {
    expect(classifyRun({ ...base, workoutType: 1, movingTimeS: 1200, metrics: null })).toMatchObject({
      runClass: "race",
      classSource: "strava",
    });
  });

  it("infers long runs from duration or being the week's longest", () => {
    expect(classifyRun({ ...base, movingTimeS: 95 * 60, metrics: null }).runClass).toBe("long");
    expect(classifyRun({ ...base, movingTimeS: 65 * 60, isWeekLongest: true, metrics: null }).runClass).toBe("long");
    expect(classifyRun({ ...base, movingTimeS: 65 * 60, metrics: null }).runClass).toBe("unknown");
  });

  it("infers workouts from time above Z4 and easy/recovery from average HR", () => {
    const intervals = metricsFor({ seconds: 2400, hr: (t) => (t % 600 < 150 ? 170 : 140) });
    expect(classifyRun({ ...base, movingTimeS: 2400, metrics: intervals }).runClass).toBe("workout");
    expect(classifyRun({ ...base, movingTimeS: 2400, metrics: metricsFor({ seconds: 2400, hr: 140 }) }).runClass).toBe("easy");
    expect(classifyRun({ ...base, movingTimeS: 1800, metrics: metricsFor({ seconds: 1800, hr: 120 }) }).runClass).toBe("recovery");
  });

  it("flags hilly runs by climbing per km", () => {
    expect(classifyRun({ ...base, elevationGainM: 200, movingTimeS: 3600, metrics: null }).hilly).toBe(true);
    expect(classifyRun({ ...base, elevationGainM: 50, movingTimeS: 3600, metrics: null }).hilly).toBe(false);
  });
});

describe("intensity distribution", () => {
  it("buckets histogram time into 5 zones", () => {
    const m = metricsFor({ seconds: 1200, hr: (t) => (t < 600 ? 140 : 165) });
    const minutes = zoneMinutesFromHistogram(m.hrHistogram, ZONES);
    expect(minutes[1].minutes).toBeCloseTo(10, 1);
    expect(minutes[3].minutes).toBeCloseTo(10, 1);
  });

  it("matches Treff's worked example of an 80/5/15 split", () => {
    // log10(0.80/0.05 × 0.15 × 100) = log10(240) ≈ 2.38
    expect(polarizationIndex(80, 5, 15)).toBeCloseTo(Math.log10(240), 6);
    expect(polarizationIndex(80, 0, 20)).toBeNull();
  });

  it("labels polarized, pyramidal and threshold weeks", () => {
    const z = (m: number[]) => m.map((minutes, i) => ({ zone: (i + 1) as 1 | 2 | 3 | 4 | 5, minutes }));
    expect(summarizeIntensity(z([200, 200, 20, 60, 20])).profile).toBe("polarized");
    expect(summarizeIntensity(z([200, 200, 80, 20, 0])).profile).toBe("pyramidal");
    expect(summarizeIntensity(z([50, 50, 200, 20, 0])).profile).toBe("threshold");
    expect(summarizeIntensity(z([5, 5, 5, 5, 0])).profile).toBe("insufficient-data");
  });
});

describe("efficiency", () => {
  it("fits a temperature effect while controlling for time", () => {
    const points = Array.from({ length: 30 }, (_, i) => {
      const tempC = 5 + (i % 6) * 4;
      return { day: i * 3, tempC, ef: 1.3 + 0.001 * i * 3 - 0.005 * tempC };
    });
    const model = fitTemperatureModel(points)!;
    expect(model.efPerDegC).toBeCloseTo(-0.005, 6);
    expect(model.n).toBe(30);
  });

  it("declines to fit a temperature model on too few runs or too little spread", () => {
    expect(fitTemperatureModel([{ day: 0, tempC: 10, ef: 1 }])).toBeNull();
    expect(fitTemperatureModel(Array.from({ length: 20 }, (_, i) => ({ day: i, tempC: 15, ef: 1 })))).toBeNull();
  });

  it("tracks EF and pace-at-HR on aerobic runs, and compares the last 28 days to the 28 before", () => {
    const runs = [
      run({ id: "old", localDate: addDaysUtc(TODAY, -40), stream: { seconds: 2400, speedMs: 2.8, hr: 140 } }),
      run({ id: "new", localDate: addDaysUtc(TODAY, -3), stream: { seconds: 2400, speedMs: 3.0, hr: 140 } }),
      run({ id: "short", localDate: addDaysUtc(TODAY, -2), stream: { seconds: 600, speedMs: 3.0, hr: 140 } }),
    ];
    const summary = buildEfficiencySummary({ runs, zones: ZONES, todayLocal: TODAY, windowDays: 90, streamsCoveragePct: 100 });

    expect(summary.runs.map((r) => r.activityId)).toEqual(["old", "new"]); // under 20 min excluded
    expect(summary.band).toMatchObject({ minBpm: 134, maxBpm: 147 });
    expect(summary.runs[1].bandPaceSecPerKm).toBeCloseTo(1000 / 3, 0);
    expect(summary.efChangePct).toBeCloseTo((3.0 / 2.8 - 1) * 100, 1);
    expect(summary.weeklyPaceAtHr.at(-1)!.isPartialWeek).toBe(true);
  });
});

describe("long runs", () => {
  it("detects long runs by duration, week-longest, or Strava tag", () => {
    expect(isLongRunActivity(run({ movingTimeS: 95 * 60 }))).toBe(true);
    expect(isLongRunActivity(run({ movingTimeS: 70 * 60, isWeekLongest: true }))).toBe(true);
    expect(isLongRunActivity(run({ movingTimeS: 50 * 60, workoutType: 2 }))).toBe(true);
    expect(isLongRunActivity(run({ movingTimeS: 70 * 60 }))).toBe(false);
  });

  it("analyses drift, fade and weekly share, and bins durability by duration", () => {
    const long = run({
      id: "long",
      localDate: "2026-09-06",
      stream: { seconds: 6000, speedMs: (t) => (t < 4500 ? 3 : 2.8), hr: (t) => 140 + (t / 6000) * 15, tempC: 18 },
    });
    const easy = run({ id: "easy", localDate: "2026-09-02", distanceM: 6000, movingTimeS: 1800 });
    const summary = buildLongRunSummary([easy, long], ZONES, 365);

    expect(summary.runs).toHaveLength(1);
    const r = summary.runs[0];
    expect(r.decouplingPct!).toBeGreaterThan(5);
    expect(r.paceFadePct!).toBeGreaterThan(5);
    expect(r.hrRiseBpm!).toBeGreaterThan(8);
    expect(r.weekSharePct!).toBeCloseTo((long.distanceM / (long.distanceM + 6000)) * 100, 3);
    expect(r.avgTempC).toBe(18);
    expect(summary.durability.find((b) => b.label === "90–120 min")!.runCount).toBe(1);
  });

  it("still lists long runs without streams, with null stream-derived fields", () => {
    const summary = buildLongRunSummary([run({ movingTimeS: 100 * 60 })], ZONES, 365);
    expect(summary.runs[0]).toMatchObject({ hasStreams: false, decouplingPct: null, paceFadePct: null });
  });
});
