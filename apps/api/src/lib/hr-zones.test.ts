import { describe, it, expect } from "vitest";
import {
  estimateHrMax,
  buildZoneBoundaries,
  zoneForHeartrate,
  parseNumberArray,
  bucketTimeInZone,
  isEligibleForDecoupling,
  computeAerobicDecoupling,
  MIN_DECOUPLING_MOVING_TIME_S,
  type DecouplingInput,
} from "./hr-zones";

describe("estimateHrMax", () => {
  it("returns null for an empty array", () => expect(estimateHrMax([])).toBeNull());
  it("returns null when every value is invalid", () => expect(estimateHrMax([0, -5, NaN])).toBeNull());
  it("returns the max of valid values, ignoring invalid ones", () => {
    expect(estimateHrMax([150, 0, 190, -1, 172])).toBe(190);
  });
});

describe("buildZoneBoundaries", () => {
  it("computes rounded bpm boundaries for a known hrMax", () => {
    const zones = buildZoneBoundaries(200);
    expect(zones).toHaveLength(5);
    expect(zones[0]).toMatchObject({ zone: 1, minBpm: 0, maxBpm: 119 }); // <60% of 200
    expect(zones[1]).toMatchObject({ zone: 2, minBpm: 120, maxBpm: 139 }); // 60-70%
    expect(zones[4]).toMatchObject({ zone: 5, minBpm: 180, maxBpm: null }); // >=90%, open-ended
  });
});

describe("zoneForHeartrate", () => {
  const zones = buildZoneBoundaries(200);

  it("classifies a value at a zone floor into that zone (boundary-inclusive)", () => {
    expect(zoneForHeartrate(120, zones)).toBe(2);
    expect(zoneForHeartrate(180, zones)).toBe(5);
  });

  it("classifies below the lowest floor as Z1, never throws", () => {
    expect(zoneForHeartrate(-10, zones)).toBe(1);
    expect(zoneForHeartrate(0, zones)).toBe(1);
  });

  it("classifies above the top zone's floor as Z5", () => {
    expect(zoneForHeartrate(250, zones)).toBe(5);
  });
});

describe("parseNumberArray", () => {
  it("rejects non-arrays and empty arrays", () => {
    expect(parseNumberArray(undefined)).toBeNull();
    expect(parseNumberArray("nope")).toBeNull();
    expect(parseNumberArray([])).toBeNull();
  });

  it("rejects an array with any non-finite entry, not just filtering it out", () => {
    expect(parseNumberArray([1, 2, "3"])).toBeNull();
    expect(parseNumberArray([1, NaN, 3])).toBeNull();
  });

  it("accepts a well-formed number array", () => {
    expect(parseNumberArray([1, 2, 3])).toEqual([1, 2, 3]);
  });
});

describe("bucketTimeInZone", () => {
  const zones = buildZoneBoundaries(200);

  it("returns all 5 zones at zero minutes for empty streams", () => {
    const result = bucketTimeInZone([], [], zones);
    expect(result.minutesByZone).toHaveLength(5);
    expect(result.totalMinutes).toBe(0);
  });

  it("does not crash on a single-sample stream", () => {
    const result = bucketTimeInZone([0], [150], zones);
    expect(result.totalMinutes).toBe(0);
  });

  it("uses the shorter length when streams are mismatched, without going out of bounds", () => {
    const result = bucketTimeInZone([0, 60, 120, 180], [150, 150], zones);
    expect(result.totalMinutes).toBe(1); // only one 60s interval counted
  });

  it("skips intervals with non-monotonic or duplicate timestamps rather than going negative", () => {
    const result = bucketTimeInZone([0, 60, 30, 90], [150, 150, 150, 150], zones);
    // interval [60->30] is negative and skipped; [0->60] and [30->90] each count once won't apply
    // since index-based iteration uses [0,60],[60,30],[30,90] — only the two positive ones count
    expect(result.totalMinutes).toBeGreaterThan(0);
    expect(Number.isNaN(result.totalMinutes)).toBe(false);
  });

  it("puts 100% of time in one zone when heartrate is constant", () => {
    const time = [0, 60, 120, 180, 240];
    const hr = [190, 190, 190, 190, 190]; // all Z5 at hrMax=200
    const result = bucketTimeInZone(time, hr, zones);
    const z5 = result.minutesByZone.find((z) => z.zone === 5)!;
    expect(z5.minutes).toBeCloseTo(4, 5); // 240s = 4min
    expect(result.totalMinutes).toBeCloseTo(4, 5);
  });
});

describe("isEligibleForDecoupling", () => {
  it("requires type Run and at least the minimum moving time, boundary-inclusive", () => {
    expect(isEligibleForDecoupling("Run", MIN_DECOUPLING_MOVING_TIME_S)).toBe(true);
    expect(isEligibleForDecoupling("Run", MIN_DECOUPLING_MOVING_TIME_S - 1)).toBe(false);
    expect(isEligibleForDecoupling("Ride", MIN_DECOUPLING_MOVING_TIME_S * 2)).toBe(false);
  });
});

function makeDecouplingInput(overrides: Partial<DecouplingInput> = {}): DecouplingInput {
  const n = 40;
  const timeSeconds = Array.from({ length: n }, (_, i) => i * 30); // 30s samples, 20min total
  return {
    activityId: "act-1",
    activityName: "Steady Run",
    localDate: "2026-06-01",
    movingTimeS: 1200,
    summaryDistanceM: 4000,
    timeSeconds,
    heartrateBpm: Array.from({ length: n }, () => 150),
    distanceMeters: Array.from({ length: n }, (_, i) => (4000 * i) / (n - 1)),
    ...overrides,
  };
}

describe("computeAerobicDecoupling", () => {
  it("returns nulls when there aren't enough samples to split meaningfully", () => {
    const input = makeDecouplingInput({
      timeSeconds: [0, 30, 60],
      heartrateBpm: [150, 150, 150],
      distanceMeters: [0, 100, 200],
    });
    const result = computeAerobicDecoupling(input);
    expect(result.ef1).toBeNull();
    expect(result.ef2).toBeNull();
    expect(result.decouplingPct).toBeNull();
  });

  it("falls back to a time-prorated distance proxy when the streams have no distance", () => {
    const input = makeDecouplingInput({ distanceMeters: null });
    const result = computeAerobicDecoupling(input);
    expect(result.usedDistanceFallback).toBe(true);
    expect(result.ef1).not.toBeNull();
  });

  it("uses the real distance stream directly when present", () => {
    const input = makeDecouplingInput();
    const result = computeAerobicDecoupling(input);
    expect(result.usedDistanceFallback).toBe(false);
  });

  it("computes positive decoupling when HR rises in the second half at constant pace", () => {
    const n = 40;
    const input = makeDecouplingInput({
      heartrateBpm: Array.from({ length: n }, (_, i) => (i < n / 2 ? 140 : 160)),
    });
    const result = computeAerobicDecoupling(input);
    expect(result.decouplingPct).not.toBeNull();
    expect(result.decouplingPct!).toBeGreaterThan(0); // slower EF in 2nd half (higher HR, same pace)
  });

  it("computes negative decoupling when HR falls in the second half (not clamped to zero)", () => {
    const n = 40;
    const input = makeDecouplingInput({
      heartrateBpm: Array.from({ length: n }, (_, i) => (i < n / 2 ? 160 : 140)),
    });
    const result = computeAerobicDecoupling(input);
    expect(result.decouplingPct!).toBeLessThan(0);
  });

  it("never divides by zero when a half has zero average HR", () => {
    const n = 40;
    const input = makeDecouplingInput({ heartrateBpm: Array.from({ length: n }, () => 0) });
    const result = computeAerobicDecoupling(input);
    expect(result.decouplingPct).toBeNull();
    expect(Number.isNaN(result.decouplingPct as unknown as number)).toBe(false);
  });
});
