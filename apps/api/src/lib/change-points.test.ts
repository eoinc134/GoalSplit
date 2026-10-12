import { describe, it, expect } from "vitest";
import { clipSpikes, detectChangePoints, robustNoiseSd, MIN_SEGMENT_WEEKS, type SeriesPoint } from "./change-points";
import { addDaysUtc } from "./dates";
import { noise } from "./__fixtures__/noise";

function weekly(values: number[]): SeriesPoint[] {
  return values.map((value, i) => ({ date: addDaysUtc("2026-01-05", 7 * i), value }));
}

describe("robustNoiseSd", () => {
  it("returns null for too-short or constant series", () => {
    expect(robustNoiseSd([1, 2])).toBeNull();
    expect(robustNoiseSd([5, 5, 5, 5])).toBeNull();
  });

  it("is barely moved by a single large level shift", () => {
    const flat = Array.from({ length: 20 }, (_, i) => 1 + noise(i, 0.02));
    const shifted = flat.map((v, i) => (i >= 10 ? v + 0.5 : v));
    expect(robustNoiseSd(shifted)!).toBeCloseTo(robustNoiseSd(flat)!, 1);
  });
});

describe("clipSpikes", () => {
  it("pulls an isolated spike to within 3 noise SDs of the local median, leaving the rest alone", () => {
    const clipped = clipSpikes([10, 11, 10, 50, 10, 11, 10], 1);
    expect(clipped[3]).toBe(14); // median of [11, 10, 50, 10, 11] is 11, + 3 SDs
    expect(clipped.filter((_, i) => i !== 3)).toEqual([10, 11, 10, 10, 11, 10]);
  });

  it("follows a sustained level shift instead of clipping it", () => {
    const values = [10, 10, 10, 10, 20, 20, 20, 20];
    expect(clipSpikes(values, 1)).toEqual(values);
  });
});

describe("detectChangePoints", () => {
  it("handles empty and short series without inventing changes", () => {
    expect(detectChangePoints([])).toMatchObject({ segments: [], changes: [] });
    const short = detectChangePoints(weekly([1, 2, 3, 4]));
    expect(short.segments).toHaveLength(1);
    expect(short.changes).toEqual([]);
  });

  it("finds no change in a stationary noisy series", () => {
    const result = detectChangePoints(weekly(Array.from({ length: 30 }, (_, i) => 1.15 + noise(i, 0.03))));
    expect(result.changes).toEqual([]);
    expect(result.segments).toHaveLength(1);
  });

  it("locates a clear step up and reports its size", () => {
    const values = Array.from({ length: 24 }, (_, i) => (i < 12 ? 1.1 : 1.2) + noise(i, 0.01));
    const result = detectChangePoints(weekly(values));
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].date).toBe(addDaysUtc("2026-01-05", 7 * 12));
    expect(result.changes[0].changePct).toBeCloseTo(9.1, 0);
    expect(result.segments.map((s) => s.weeks)).toEqual([12, 12]);
  });

  it("finds multiple phases, e.g. build → peak → taper", () => {
    const values = [
      ...Array.from({ length: 8 }, (_, i) => 300 + noise(i, 15)),
      ...Array.from({ length: 8 }, (_, i) => 600 + noise(i + 8, 15)),
      ...Array.from({ length: 5 }, (_, i) => 250 + noise(i + 16, 15)),
    ];
    const result = detectChangePoints(weekly(values));
    expect(result.segments.map((s) => s.weeks)).toEqual([8, 8, 5]);
    expect(result.changes[0].after).toBeGreaterThan(result.changes[0].before);
    expect(result.changes[1].after).toBeLessThan(result.changes[1].before);
  });

  it("doesn't let a single outlier week fake a shift", () => {
    const values = Array.from({ length: 20 }, (_, i) => 360 + noise(i, 8));
    values[10] = 500; // one terrible week mid-series
    expect(detectChangePoints(weekly(values)).changes).toEqual([]);
  });

  it("never reports a segment shorter than the minimum, even for a one-week spike", () => {
    const values = Array.from({ length: 20 }, (_, i) => 1 + noise(i, 0.02));
    values[10] = 3;
    const result = detectChangePoints(weekly(values));
    expect(result.segments.every((s) => s.weeks >= MIN_SEGMENT_WEEKS)).toBe(true);
  });
});
