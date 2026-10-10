import { describe, it, expect } from "vitest";
import {
  computeActivityMetrics,
  decoupling,
  efficiencyFactor,
  gapPaceSecPerKm,
  overallSegment,
  paceInHrBand,
  quarterFade,
  METRICS_VERSION,
} from "./activity-metrics";
import { gapFactor, minettiCost } from "./gap";
import { syntheticStreams } from "./__fixtures__/streams";

const RUN = { isRun: true, summaryDistanceM: 10_000 };

describe("Minetti GAP", () => {
  it("is neutral on the flat", () => {
    expect(minettiCost(0)).toBeCloseTo(3.6);
    expect(gapFactor(0)).toBeCloseTo(1);
  });

  it("credits climbs more and gentle descents less than flat metres", () => {
    expect(gapFactor(0.1)).toBeCloseTo(1.66, 2);
    expect(gapFactor(-0.05)).toBeLessThan(1);
    expect(gapFactor(-0.05)).toBeGreaterThan(0.6);
  });

  it("clamps grades outside the ±45% range the model was fit on", () => {
    expect(gapFactor(0.9)).toBeCloseTo(gapFactor(0.45));
    expect(gapFactor(-0.9)).toBeCloseTo(gapFactor(-0.45));
  });
});

describe("computeActivityMetrics", () => {
  it("returns null without a usable time stream", () => {
    expect(computeActivityMetrics({}, RUN)).toBeNull();
    expect(computeActivityMetrics({ time: { data: [0] } }, RUN)).toBeNull();
  });

  it("summarises a steady flat run", () => {
    const m = computeActivityMetrics(syntheticStreams({ seconds: 3600, speedMs: 3, hr: 150, tempC: 12 }), RUN)!;
    expect(m.version).toBe(METRICS_VERSION);
    expect(m.hasHr).toBe(true);
    expect(m.movingSeconds).toBe(3600);
    expect(m.distanceM).toBeCloseTo(10_800, 0);
    expect(m.gapDistanceM).toBeCloseTo(m.distanceM, 0);
    expect(m.hrHistogram).toEqual([[150, 3600, 3600, expect.closeTo(10_800, 0), expect.closeTo(10_800, 0)]]);
    expect(m.quarters.map((q) => q.seconds)).toEqual([900, 900, 900, 900]);
    expect(m.avgTempC).toBe(12);
  });

  it("grade-adjusts distance on climbs for runs only", () => {
    const streams = syntheticStreams({ seconds: 600, speedMs: 2.5, hr: 160, gradePct: 8 });
    const run = computeActivityMetrics(streams, RUN)!;
    const ride = computeActivityMetrics(streams, { isRun: false, summaryDistanceM: 0 })!;
    expect(run.gradeSource).toBe("grade_smooth");
    expect(run.gapDistanceM / run.distanceM).toBeCloseTo(gapFactor(0.08), 2);
    expect(ride.gapDistanceM).toBeCloseTo(ride.distanceM);
  });

  it("counts stopped time towards HR seconds but not moving pace", () => {
    const m = computeActivityMetrics(
      syntheticStreams({ seconds: 1200, hr: 140, moving: (t) => t < 600 || t >= 900 }),
      RUN,
    )!;
    const [, seconds, movingSeconds] = m.hrHistogram[0];
    expect(seconds).toBe(1200);
    expect(movingSeconds).toBeCloseTo(900, 0);
    expect(m.movingSeconds).toBeCloseTo(900, 0);
  });

  it("skips recording gaps longer than 30 s", () => {
    const m = computeActivityMetrics(
      { time: { data: [0, 1, 2, 300, 301] }, distance: { data: [0, 3, 6, 9, 12] }, heartrate: { data: [140, 140, 140, 140, 140] } },
      RUN,
    )!;
    expect(m.movingSeconds).toBe(3);
  });

  it("prorates summary distance when there's no distance stream (treadmill)", () => {
    const m = computeActivityMetrics(syntheticStreams({ seconds: 1000, hr: 150, includeDistance: false }), {
      isRun: true,
      summaryDistanceM: 3000,
    })!;
    expect(m.usedDistanceFallback).toBe(true);
    expect(m.distanceM).toBeCloseTo(3000, 0);
  });

  it("ignores physiologically impossible HR samples", () => {
    const m = computeActivityMetrics(syntheticStreams({ seconds: 100, hr: (t) => (t < 50 ? 0 : 150) }), RUN)!;
    expect(m.hrHistogram.map((b) => b[0])).toEqual([150]);
  });
});

describe("derived per-run figures", () => {
  it("reports ~0% decoupling and no fade on a perfectly steady run", () => {
    const m = computeActivityMetrics(syntheticStreams({ seconds: 3600, speedMs: 3, hr: 150 }), RUN)!;
    expect(decoupling(m).pct).toBeCloseTo(0, 1);
    expect(quarterFade(m).paceFadePct).toBeCloseTo(0, 1);
    expect(quarterFade(m).hrRiseBpm).toBeCloseTo(0, 1);
    // 180 m/min at 150 bpm
    expect(efficiencyFactor(m)).toBeCloseTo(1.2, 2);
    expect(gapPaceSecPerKm(overallSegment(m))).toBeCloseTo(1000 / 3, 0);
  });

  it("reports positive decoupling when HR drifts up at constant pace", () => {
    const m = computeActivityMetrics(syntheticStreams({ seconds: 3600, speedMs: 3, hr: (t) => 140 + (t / 3600) * 20 }), RUN)!;
    expect(decoupling(m).pct!).toBeGreaterThan(5);
    expect(quarterFade(m).hrRiseBpm!).toBeGreaterThan(10);
  });

  it("reports pace fade when the last quarter slows", () => {
    const m = computeActivityMetrics(syntheticStreams({ seconds: 4000, speedMs: (t) => (t < 3000 ? 3 : 2.7), hr: 150 }), RUN)!;
    expect(quarterFade(m).paceFadePct!).toBeCloseTo(11.1, 0);
  });

  it("measures moving time and GAP distance inside an HR band", () => {
    const m = computeActivityMetrics(syntheticStreams({ seconds: 1200, speedMs: 3, hr: (t) => (t < 600 ? 130 : 160) }), RUN)!;
    const band = paceInHrBand(m, 125, 135);
    expect(band.seconds).toBeCloseTo(600, 0);
    expect(band.gapDistanceM).toBeCloseTo(1800, 0);
  });
});
