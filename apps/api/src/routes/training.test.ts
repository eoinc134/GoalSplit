import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../db/index.js", () => ({
  sql: vi.fn(),
  initSchema: vi.fn().mockResolvedValue(undefined),
}));

import { app } from "../app.js";
import { sql } from "../db/index.js";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/training/load", () => {
  it("returns an insufficient-history summary when no user exists", async () => {
    mockSql.mockResolvedValueOnce([]); // users
    const res = await request(app).get("/api/training/load");
    expect(res.status).toBe(200);
    expect(res.body.data.acwr).toBeNull();
    expect(res.body.data.insufficientHistory).toBe(true);
  });

  it("builds a load summary from activities and their list-dump suffer_score", async () => {
    mockSql
      .mockResolvedValueOnce([{ id: "user-1" }]) // users
      .mockResolvedValueOnce([{ today: "2026-09-08", first_date: "2026-08-01" }]) // bounds
      .mockResolvedValueOnce([{ id: "act-1", local_date: "2026-09-08" }]) // activities in window
      .mockResolvedValueOnce([{ activity_id: "act-1", payload: { suffer_score: 60 } }]); // list dumps

    const res = await request(app).get("/api/training/load");

    expect(res.status).toBe(200);
    expect(res.body.data.asOf).toBe("2026-09-08");
    expect(res.body.data.daily).toHaveLength(28);
    expect(res.body.data.insufficientHistory).toBe(false);
    expect(res.body.data.acute.totalLoad).toBe(60);
  });

  it("skips the dump lookup entirely when there are no activities in the window", async () => {
    mockSql
      .mockResolvedValueOnce([{ id: "user-1" }]) // users
      .mockResolvedValueOnce([{ today: "2026-09-08", first_date: null }]) // bounds
      .mockResolvedValueOnce([]); // activities in window

    const res = await request(app).get("/api/training/load");

    expect(res.status).toBe(200);
    expect(mockSql).toHaveBeenCalledTimes(3);
    expect(res.body.data.insufficientHistory).toBe(true);
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
  it("returns a zeroed summary when no user exists", async () => {
    mockSql.mockResolvedValueOnce([]); // users
    const res = await request(app).get("/api/training/hr-zones");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      hrMaxEstimate: null,
      zones: [],
      activityCount: 0,
      coveragePct: null,
      zoneModel: "percent-max",
      restingHeartRateEstimate: null,
    });
  });

  it("returns zeroed zones when no max_heartrate has ever been recorded", async () => {
    mockSql
      .mockResolvedValueOnce([{ id: "user-1" }]) // users
      .mockResolvedValueOnce([]) // hrRows (Strava)
      .mockResolvedValueOnce([]) // garminHrRows
      .mockResolvedValueOnce([]) // latestResting
      .mockResolvedValueOnce([{ id: "act-1" }]); // activityRows

    const res = await request(app).get("/api/training/hr-zones");

    expect(res.status).toBe(200);
    expect(res.body.data.hrMaxEstimate).toBeNull();
    expect(res.body.data.zones).toEqual([]);
    expect(res.body.data.zoneModel).toBe("percent-max");
    // No streams lookup should fire when there are no zones to bucket into.
    expect(mockSql).toHaveBeenCalledTimes(5);
  });

  it("reports zero streams coverage when activities exist but none have a streams dump yet", async () => {
    mockSql
      .mockResolvedValueOnce([{ id: "user-1" }]) // users
      .mockResolvedValueOnce([{ max_heartrate: 190 }]) // hrRows
      .mockResolvedValueOnce([]) // garminHrRows
      .mockResolvedValueOnce([]) // latestResting
      .mockResolvedValueOnce([{ id: "act-1" }, { id: "act-2" }]) // activityRows
      .mockResolvedValueOnce([]); // streamRows — backfill hasn't run yet

    const res = await request(app).get("/api/training/hr-zones");

    expect(res.status).toBe(200);
    expect(res.body.data.hrMaxEstimate).toBe(190);
    expect(res.body.data.activityCount).toBe(2);
    expect(res.body.data.streamsCount).toBe(0);
    expect(res.body.data.coveragePct).toBe(0);
    expect(res.body.data.minutesByZone).toHaveLength(5);
    expect(res.body.data.zoneModel).toBe("percent-max");
  });

  it("buckets real streams data into zones", async () => {
    mockSql
      .mockResolvedValueOnce([{ id: "user-1" }]) // users
      .mockResolvedValueOnce([{ max_heartrate: 200 }]) // hrRows
      .mockResolvedValueOnce([]) // garminHrRows
      .mockResolvedValueOnce([]) // latestResting
      .mockResolvedValueOnce([{ id: "act-1" }]) // activityRows
      .mockResolvedValueOnce([
        {
          heartrate_data: [190, 190, 190],
          time_data: [0, 60, 120],
        },
      ]); // streamRows

    const res = await request(app).get("/api/training/hr-zones");

    expect(res.status).toBe(200);
    expect(res.body.data.streamsCount).toBe(1);
    expect(res.body.data.coveragePct).toBe(100);
    expect(res.body.data.totalMinutes).toBeGreaterThan(0);
  });

  it("upgrades to the Karvonen model once a Garmin resting HR is available", async () => {
    mockSql
      .mockResolvedValueOnce([{ id: "user-1" }]) // users
      .mockResolvedValueOnce([{ max_heartrate: 190 }]) // hrRows
      .mockResolvedValueOnce([{ max_heart_rate: 195 }]) // garminHrRows — higher than Strava's own max
      .mockResolvedValueOnce([{ resting_heart_rate: 50 }]) // latestResting
      .mockResolvedValueOnce([{ id: "act-1" }]) // activityRows
      .mockResolvedValueOnce([]); // streamRows

    const res = await request(app).get("/api/training/hr-zones");

    expect(res.status).toBe(200);
    expect(res.body.data.zoneModel).toBe("karvonen");
    expect(res.body.data.restingHeartRateEstimate).toBe(50);
    // Garmin's 195 beat Strava's 190 — the merged estimate should reflect that.
    expect(res.body.data.hrMaxEstimate).toBe(195);
    expect(res.body.data.zones[0].minBpm).toBe(50); // Karvonen zone 1 floor is hrRest itself
  });
});

describe("GET /api/training/hr-drift", () => {
  it("returns a zeroed summary when no user exists", async () => {
    mockSql.mockResolvedValueOnce([]); // users
    const res = await request(app).get("/api/training/hr-drift");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ qualifyingRunCount: 0, streamsCount: 0, coveragePct: null, runs: [] });
  });

  it("reports zero streams coverage when qualifying runs exist but have no streams dump yet", async () => {
    mockSql
      .mockResolvedValueOnce([{ id: "user-1" }]) // users
      .mockResolvedValueOnce([
        { id: "act-1", name: "Long Run", moving_time: 2400, distance: 8000, local_date: "2026-06-01" },
      ]) // runRows
      .mockResolvedValueOnce([]); // streamRows

    const res = await request(app).get("/api/training/hr-drift");

    expect(res.status).toBe(200);
    expect(res.body.data.qualifyingRunCount).toBe(1);
    expect(res.body.data.streamsCount).toBe(0);
    expect(res.body.data.coveragePct).toBe(0);
    expect(res.body.data.runs).toEqual([]);
  });

  it("computes decoupling for a qualifying run with usable streams", async () => {
    const n = 40;
    const timeSeconds = Array.from({ length: n }, (_, i) => i * 30);
    const heartrateBpm = Array.from({ length: n }, (_, i) => (i < n / 2 ? 140 : 160));
    const distanceMeters = Array.from({ length: n }, (_, i) => (8000 * i) / (n - 1));

    mockSql
      .mockResolvedValueOnce([{ id: "user-1" }]) // users
      .mockResolvedValueOnce([
        { id: "act-1", name: "Long Run", moving_time: 1200, distance: 8000, local_date: "2026-06-01" },
      ]) // runRows
      .mockResolvedValueOnce([
        { activity_id: "act-1", heartrate_data: heartrateBpm, time_data: timeSeconds, distance_data: distanceMeters },
      ]); // streamRows

    const res = await request(app).get("/api/training/hr-drift");

    expect(res.status).toBe(200);
    expect(res.body.data.streamsCount).toBe(1);
    expect(res.body.data.runs).toHaveLength(1);
    expect(res.body.data.runs[0].usedDistanceFallback).toBe(false);
    expect(res.body.data.runs[0].decouplingPct).not.toBeNull();
  });

  it("clamps limit to the 1-50 range", async () => {
    mockSql.mockResolvedValueOnce([]); // users
    const res = await request(app).get("/api/training/hr-drift?limit=9999");
    // limit isn't echoed in the response, but the clamp must not throw / must still 200
    expect(res.status).toBe(200);
  });
});
