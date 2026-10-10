import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../db/index.js", () => ({
  sql: vi.fn(),
  initSchema: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/analytics-data.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/analytics-data.service.js")>();
  return {
    ...actual,
    getCurrentUserId: vi.fn(),
    getPhysiology: vi.fn(),
    loadAnalyticsActivities: vi.fn(),
  };
});

import { app } from "../app.js";
import { sql } from "../db/index.js";
import {
  getCurrentUserId,
  getPhysiology,
  loadAnalyticsActivities,
  physiologyFrom,
} from "../services/analytics-data.service.js";
import { computeActivityMetrics } from "../lib/activity-metrics.js";
import type { AnalyticsActivity } from "../lib/analytics-activity.js";
import { syntheticStreams } from "../lib/__fixtures__/streams.js";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;
const mockUserId = vi.mocked(getCurrentUserId);
const mockPhysiology = vi.mocked(getPhysiology);
const mockLoad = vi.mocked(loadAnalyticsActivities);

const TODAY = "2026-09-09";
const PHYSIOLOGY = physiologyFrom({ activityMaxHr: 190, garminMaxHr: null, restingMedian: 50, sex: "M" });

function activity(overrides: Partial<AnalyticsActivity> = {}): AnalyticsActivity {
  const metrics = computeActivityMetrics(syntheticStreams({ seconds: 3600, speedMs: 3, hr: 145 }), {
    isRun: true,
    summaryDistanceM: 10_800,
  });
  return {
    id: "act-1",
    name: "Morning Run",
    type: "Run",
    localDate: TODAY,
    movingTimeS: 3600,
    distanceM: 10_800,
    elevationGainM: 20,
    averageHeartrate: 145,
    workoutType: null,
    isWeekLongest: true,
    metrics,
    ...overrides,
  };
}

function withActivities(activities: AnalyticsActivity[]) {
  mockUserId.mockResolvedValue("user-1");
  mockPhysiology.mockResolvedValue(PHYSIOLOGY);
  mockLoad.mockResolvedValue({ today: TODAY, firstActivityDate: "2026-01-01", activities, metricsPending: 0 });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/training/load", () => {
  it("returns an empty, insufficient-history summary when no user exists", async () => {
    mockUserId.mockResolvedValue(null);
    const res = await request(app).get("/api/training/load");
    expect(res.status).toBe(200);
    expect(res.body.data.current.acwr).toBeNull();
    expect(res.body.data.insufficientHistory).toBe(true);
    expect(res.body.data.daily).toHaveLength(90);
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it("scores stream TRIMP and falls back to average HR", async () => {
    withActivities([activity(), activity({ id: "act-2", metrics: null, averageHeartrate: 130 })]);
    const res = await request(app).get("/api/training/load?days=28");

    expect(res.status).toBe(200);
    expect(res.body.data.daily).toHaveLength(28);
    expect(res.body.data.coverage).toMatchObject({ streamScored: 1, averageScored: 1, coveragePct: 100 });
    expect(res.body.data.current.load7d).toBeGreaterThan(0);
    expect(res.body.data.physiology).toMatchObject({ hrMax: 190, hrRest: 50, zoneModel: "karvonen" });
    // Full history is loaded so the EWMAs start from the right place.
    expect(mockLoad).toHaveBeenCalledWith("user-1", { days: undefined, runsOnly: false });
  });
});

describe("GET /api/training/trends", () => {
  it("returns empty series when no user exists", async () => {
    mockSql.mockResolvedValueOnce([]); // users
    const res = await request(app).get("/api/training/trends");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ weeks: 12, volumeByType: [], runPace: [] });
  });

  it("returns weekly volume-by-type and run-pace series, flagging the current week", async () => {
    mockSql
      .mockResolvedValueOnce([{ id: "user-1" }]) // users
      .mockResolvedValueOnce([{ week_start: "2026-09-07" }]) // current week start
      .mockResolvedValueOnce([
        { week_start: "2026-08-31", type: "Run", activity_count: 3, distance_m: 15000, moving_time_s: 5400 },
        { week_start: "2026-09-07", type: "Run", activity_count: 1, distance_m: 5000, moving_time_s: 1800 },
      ])
      .mockResolvedValueOnce([
        { week_start: "2026-08-31", distance_m: 15000, moving_time_s: 5400 },
        { week_start: "2026-09-07", distance_m: 5000, moving_time_s: 1800 },
      ]);

    const res = await request(app).get("/api/training/trends?weeks=8");

    expect(res.status).toBe(200);
    expect(res.body.data.weeks).toBe(8);
    expect(res.body.data.volumeByType).toHaveLength(2);
    expect(res.body.data.volumeByType[0].isPartialWeek).toBe(false);
    expect(res.body.data.volumeByType[1].isPartialWeek).toBe(true);
    expect(res.body.data.runPace[1].isPartialWeek).toBe(true);
  });

  it("clamps weeks to the 1-52 range", async () => {
    mockSql.mockResolvedValueOnce([]); // users
    const res = await request(app).get("/api/training/trends?weeks=9999");
    expect(res.body.data.weeks).toBe(52);
  });
});

describe("GET /api/training/hr-zones", () => {
  it("returns no zones without an HRmax estimate", async () => {
    mockUserId.mockResolvedValue(null);
    const res = await request(app).get("/api/training/hr-zones");
    expect(res.body.data).toMatchObject({ hrMaxEstimate: null, zones: [], minutesByZone: [], zoneModel: "percent-max" });
  });

  it("sums time in zone from stored histograms and reports coverage", async () => {
    withActivities([activity(), activity({ id: "act-2", metrics: null })]);
    const res = await request(app).get("/api/training/hr-zones?days=28");
    expect(res.body.data.zoneModel).toBe("karvonen");
    expect(res.body.data.restingHeartRateEstimate).toBe(50);
    expect(res.body.data.minutesByZone).toHaveLength(5);
    expect(res.body.data.minutesByZone[1].minutes).toBeCloseTo(60, 0); // 145 bpm is Z2
    expect(res.body.data).toMatchObject({ activityCount: 2, streamsCount: 1, coveragePct: 50 });
  });
});

describe("GET /api/training/hr-drift", () => {
  it("computes GAP-based decoupling for qualifying runs, most recent first", async () => {
    withActivities([
      activity({ id: "old", localDate: "2026-09-01" }),
      activity({ id: "short", movingTimeS: 600 }),
      activity({ id: "new", localDate: "2026-09-08" }),
    ]);
    const res = await request(app).get("/api/training/hr-drift");
    expect(res.body.data.qualifyingRunCount).toBe(2);
    expect(res.body.data.runs.map((r: { activityId: string }) => r.activityId)).toEqual(["new", "old"]);
    expect(res.body.data.runs[0].decouplingPct).toBeCloseTo(0, 1);
  });

  it("clamps limit to 50", async () => {
    withActivities([]);
    const res = await request(app).get("/api/training/hr-drift?limit=9999");
    expect(res.status).toBe(200);
  });
});

describe("GET /api/training/intensity", () => {
  it("returns whole calendar weeks with a 3-zone breakdown", async () => {
    withActivities([activity()]);
    const res = await request(app).get("/api/training/intensity?weeks=4");
    expect(res.body.data.weekly).toHaveLength(4);
    expect(res.body.data.weekly[3]).toMatchObject({ weekStart: "2026-09-07", isPartialWeek: true });
    expect(res.body.data.weekly[3].lowMinutes).toBeCloseTo(60, 0);
    expect(res.body.data.overall.lowPct).toBeCloseTo(100);
  });
});

describe("GET /api/training/efficiency", () => {
  it("returns per-run EF and the Z2 pace-at-HR band", async () => {
    withActivities([activity()]);
    const res = await request(app).get("/api/training/efficiency");
    expect(res.body.data.windowDays).toBe(180);
    expect(res.body.data.runs).toHaveLength(1);
    expect(res.body.data.runs[0].ef).toBeCloseTo(180 / 145, 2);
    expect(res.body.data.band).toMatchObject({ minBpm: 134, maxBpm: 147 });
  });
});

describe("GET /api/training/long-runs", () => {
  it("lists long runs with the rule used", async () => {
    withActivities([activity({ movingTimeS: 100 * 60 })]);
    const res = await request(app).get("/api/training/long-runs");
    expect(res.body.data.runs).toHaveLength(1);
    expect(res.body.data.definition).toMatch(/90\+ minutes/);
    expect(res.body.data.durability).toHaveLength(4);
  });
});
