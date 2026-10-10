import { describe, it, expect } from "vitest";
import { activityLoad, trimpCoefficientFor, trimpFromAverage, trimpFromHistogram, trimpWeight } from "./trimp";
import type { HrBucket } from "./activity-metrics";

const P = { hrMax: 190, hrRest: 50, trimpCoefficient: 1.92 };

describe("Banister TRIMP", () => {
  it("picks the sex-specific coefficient, defaulting to the male one", () => {
    expect(trimpCoefficientFor("F")).toBe(1.67);
    expect(trimpCoefficientFor("M")).toBe(1.92);
    expect(trimpCoefficientFor(null)).toBe(1.92);
  });

  it("weights an hour at 50% HRR as Banister's formula does", () => {
    // 60 min × 0.5 × 0.64 × e^(1.92 × 0.5) ≈ 50.2
    expect(trimpFromAverage(120, 3600, P)).toBeCloseTo(60 * 0.5 * 0.64 * Math.exp(0.96), 5);
  });

  it("uses the paired female coefficients (0.86, 1.67)", () => {
    expect(trimpFromAverage(120, 3600, { ...P, trimpCoefficient: 1.67 })).toBeCloseTo(60 * 0.5 * 0.86 * Math.exp(1.67 * 0.5), 5);
  });

  it("clamps HRR to [0, 1]", () => {
    expect(trimpWeight(40, P)).toBe(0);
    expect(trimpWeight(250, P)).toBeCloseTo(trimpWeight(190, P));
  });

  it("returns zero weight when HRmax is unknown or not above rest", () => {
    expect(trimpWeight(150, { ...P, hrMax: null })).toBe(0);
    expect(trimpWeight(150, { ...P, hrMax: 50 })).toBe(0);
  });

  it("scores intervals higher from the histogram than from their average HR", () => {
    const histogram: HrBucket[] = [
      [110, 1800, 1800, 0, 0],
      [170, 1800, 1800, 0, 0],
    ];
    expect(trimpFromHistogram(histogram, P)).toBeGreaterThan(trimpFromAverage(140, 3600, P));
  });
});

describe("activityLoad", () => {
  const histogram: HrBucket[] = [[150, 3600, 3600, 0, 0]];

  it("prefers stream histograms, then average HR, then nothing", () => {
    expect(activityLoad({ histogram, averageHeartrate: 150, movingTimeS: 3600 }, P).source).toBe("stream");
    expect(activityLoad({ histogram: null, averageHeartrate: 150, movingTimeS: 3600 }, P).source).toBe("average-hr");
    expect(activityLoad({ histogram: null, averageHeartrate: null, movingTimeS: 3600 }, P)).toEqual({ load: 0, source: "none" });
  });

  it("scores nothing without an HRmax estimate", () => {
    expect(activityLoad({ histogram, averageHeartrate: 150, movingTimeS: 3600 }, { ...P, hrMax: null }).source).toBe("none");
  });
});
