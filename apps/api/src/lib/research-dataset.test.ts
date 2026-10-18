import { describe, it, expect } from "vitest";
import { buildResearchDataset } from "./research-dataset";
import { computeActivityMetrics } from "./activity-metrics";
import type { AnalyticsActivity } from "./analytics-activity";
import { buildZoneBoundariesKarvonen } from "./hr-zones";
import { syntheticStreams } from "./__fixtures__/streams";
import type { AthletePhysiology } from "@goalsplit/types";

const PHYSIOLOGY: AthletePhysiology = {
  hrMax: 190,
  hrRest: 50,
  hrRestSource: "garmin",
  sex: "M",
  trimpCoefficient: 1.92,
  zoneModel: "karvonen",
  zones: buildZoneBoundariesKarvonen(190, 50),
};

function activity(overrides: Partial<AnalyticsActivity> = {}): AnalyticsActivity {
  return {
    id: "run-1",
    name: "Easy run",
    type: "Run",
    localDate: "2026-09-08",
    movingTimeS: 3600,
    distanceM: 10_800,
    elevationGainM: 20,
    averageHeartrate: 140,
    workoutType: null,
    isWeekLongest: false,
    metrics: computeActivityMetrics(syntheticStreams({ seconds: 3600, speedMs: 3, hr: 140 }), {
      isRun: true,
      summaryDistanceM: 10_800,
    }),
    ...overrides,
  };
}

describe("buildResearchDataset", () => {
  it("exports run metrics, a full daily load spine, and the Z2 band", () => {
    const ride = activity({ id: "ride-1", type: "Ride", localDate: "2026-09-10", metrics: null, averageHeartrate: 130 });
    const ds = buildResearchDataset({
      activities: [activity(), ride],
      physiology: PHYSIOLOGY,
      today: "2026-09-12",
      firstActivityDate: "2026-09-08",
      generatedAt: "2026-09-12T10:00:00Z",
    });

    expect(ds.daily.map((d) => d.date)).toEqual(["2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12"]);
    expect(ds.daily[1].load).toBe(0);
    expect(ds.z2Band).toEqual({ minBpm: 134, maxBpm: 147 });

    const [run, rideOut] = ds.activities;
    expect(run).toMatchObject({ runClass: "easy", loadSource: "stream", hasStreams: true });
    expect(run.ef).toBeCloseTo(180 / 140, 3);
    expect(run.z2Seconds).toBeCloseTo(3600, 0);
    expect(run.zoneMinutes?.[1].minutes).toBeCloseTo(60, 0);

    // Non-runs still carry load (it's sport-agnostic) but no run metrics.
    expect(rideOut).toMatchObject({ loadSource: "average-hr", runClass: null, gapPaceSecPerKm: null, hasStreams: false });
    expect(rideOut.trimp).toBeGreaterThan(0);
  });

  it("returns an empty spine with no history", () => {
    const ds = buildResearchDataset({
      activities: [],
      physiology: PHYSIOLOGY,
      today: "2026-09-12",
      firstActivityDate: null,
      generatedAt: "2026-09-12T10:00:00Z",
    });
    expect(ds.daily).toEqual([]);
  });
});
