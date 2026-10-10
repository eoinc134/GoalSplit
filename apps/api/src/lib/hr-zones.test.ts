import { describe, it, expect } from "vitest";
import {
  estimateHrMax,
  buildZoneBoundaries,
  buildZoneBoundariesKarvonen,
  zoneForHeartrate,
  parseNumberArray,
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

describe("buildZoneBoundariesKarvonen", () => {
  it("computes HRR-based boundaries for known hrMax/hrRest values", () => {
    // hrMax=190, hrRest=50 -> HRR=140
    const zones = buildZoneBoundariesKarvonen(190, 50);
    expect(zones).toHaveLength(5);
    expect(zones[0]).toMatchObject({ zone: 1, minBpm: 50, maxBpm: 133 }); // 50 + 0%*140 .. 50+60%*140-1
    expect(zones[1]).toMatchObject({ zone: 2, minBpm: 134, maxBpm: 147 }); // 50+60%*140 .. 50+70%*140-1
    expect(zones[4]).toMatchObject({ zone: 5, minBpm: 176, maxBpm: null }); // 50+90%*140, open-ended
  });

  it("degrades to a flat hrRest floor when hrMax equals hrRest (zero HRR)", () => {
    const zones = buildZoneBoundariesKarvonen(150, 150);
    expect(zones.every((z) => z.minBpm === 150)).toBe(true);
  });

  it("differs from the %-of-max model for the same hrMax, since it accounts for resting HR", () => {
    const percentMax = buildZoneBoundaries(190);
    const karvonen = buildZoneBoundariesKarvonen(190, 50);
    expect(karvonen[2].minBpm).not.toBe(percentMax[2].minBpm);
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
