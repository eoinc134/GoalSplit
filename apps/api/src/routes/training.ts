import { Router } from "express";
import { sql } from "../db/index.js";
import {
  buildTrainingLoadSummary,
  type ActivityLoadInput,
  type ListPayloadByActivityId,
} from "../lib/training-load.js";
import {
  estimateHrMax,
  buildZoneBoundaries,
  bucketTimeInZone,
  parseNumberArray,
  computeAerobicDecoupling,
  MIN_DECOUPLING_MOVING_TIME_S,
} from "../lib/hr-zones.js";
import type {
  WeeklyVolumePoint,
  WeeklyPacePoint,
  HrZoneSummary,
  DecouplingResult,
  HrDriftSummary,
} from "@goalsplit/types";

// HR-zone time and aerobic decoupling read the `streams` dump — populated only
// once "Backfill History" has run against real activities, so both endpoints
// below report a `streamsCount`/`coveragePct` and degrade to a zeroed response
// rather than erroring when that hasn't happened yet. Grade-adjusted pace,
// power curves, and real HR/power zones from Strava's /athlete/zones (which
// would need a broader OAuth scope than this app currently requests) remain
// deferred — not built here.
export const trainingRouter = Router();

trainingRouter.get("/load", async (_req, res) => {
  const [user] = await sql<{ id: string }[]>`SELECT id FROM users LIMIT 1`;
  if (!user) {
    const today = new Date().toISOString().slice(0, 10);
    return res.json({
      data: buildTrainingLoadSummary({
        activities: [],
        listPayloadByActivityId: {},
        todayLocal: today,
        firstActivityLocalDate: null,
      }),
    });
  }

  const [bounds] = await sql<{ today: string; first_date: string | null }[]>`
    SELECT CURRENT_DATE::text AS today,
           MIN((start_date_local AT TIME ZONE 'UTC')::date)::text AS first_date
    FROM activities
    WHERE user_id = ${user.id}
  `;

  // start_date_local is a local wall-clock reading stored with a UTC label (Strava
  // convention) — AT TIME ZONE 'UTC' reads it back losslessly regardless of the
  // server's configured timezone, matching training-export.ts's date handling.
  const activityRows = await sql<{ id: string; local_date: string }[]>`
    SELECT id, (start_date_local AT TIME ZONE 'UTC')::date::text AS local_date
    FROM activities
    WHERE user_id = ${user.id}
      AND (start_date_local AT TIME ZONE 'UTC')::date >= CURRENT_DATE - INTERVAL '27 days'
    ORDER BY start_date_local
  `;

  const activities: ActivityLoadInput[] = activityRows.map((r) => ({ id: r.id, localDate: r.local_date }));

  // Latest 'list' dump per activity — same scoped-by-id lookup pattern as
  // activities.ts's fetchDumpsForActivities, so this never scans the
  // append-only, ever-growing activity_dumps table broadly.
  const dumpRows = activities.length
    ? await sql<{ activity_id: string; payload: Record<string, unknown> }[]>`
        SELECT DISTINCT ON (activity_id) activity_id, payload
        FROM activity_dumps
        WHERE activity_id = ANY(${activities.map((a) => a.id)}) AND source = 'list'
        ORDER BY activity_id, fetched_at DESC
      `
    : [];

  const listPayloadByActivityId: ListPayloadByActivityId = {};
  for (const row of dumpRows) listPayloadByActivityId[row.activity_id] = row.payload;

  const summary = buildTrainingLoadSummary({
    activities,
    listPayloadByActivityId,
    todayLocal: bounds.today,
    firstActivityLocalDate: bounds.first_date,
  });

  return res.json({ data: summary });
});

trainingRouter.get("/trends", async (req, res) => {
  const weeks = Math.min(Math.max(parseInt(String(req.query.weeks ?? "12")) || 12, 1), 52);

  const [user] = await sql<{ id: string }[]>`SELECT id FROM users LIMIT 1`;
  if (!user) {
    return res.json({ data: { weeks, volumeByType: [], runPace: [] } });
  }

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - weeks * 7);
  const cutoffDateStr = cutoff.toISOString().slice(0, 10);

  const [{ week_start: currentWeekStart }] = await sql<{ week_start: string }[]>`
    SELECT date_trunc('week', CURRENT_DATE)::date::text AS week_start
  `;

  const volumeRows = await sql<
    { week_start: string; type: string; activity_count: number; distance_m: number; moving_time_s: number }[]
  >`
    SELECT
      date_trunc('week', (start_date_local AT TIME ZONE 'UTC'))::date::text AS week_start,
      type,
      COUNT(*)::INTEGER AS activity_count,
      SUM(distance)    AS distance_m,
      SUM(moving_time) AS moving_time_s
    FROM activities
    WHERE user_id = ${user.id}
      AND (start_date_local AT TIME ZONE 'UTC')::date >= ${cutoffDateStr}::date
    GROUP BY week_start, type
    ORDER BY week_start, type
  `;

  const paceRows = await sql<{ week_start: string; distance_m: number; moving_time_s: number }[]>`
    SELECT
      date_trunc('week', (start_date_local AT TIME ZONE 'UTC'))::date::text AS week_start,
      SUM(distance)    AS distance_m,
      SUM(moving_time) AS moving_time_s
    FROM activities
    WHERE user_id = ${user.id} AND type = 'Run'
      AND (start_date_local AT TIME ZONE 'UTC')::date >= ${cutoffDateStr}::date
    GROUP BY week_start
    ORDER BY week_start
  `;

  const volumeByType: WeeklyVolumePoint[] = volumeRows.map((r) => ({
    weekStart: r.week_start,
    type: r.type,
    activityCount: r.activity_count,
    distanceM: r.distance_m,
    movingTimeS: r.moving_time_s,
    isPartialWeek: r.week_start === currentWeekStart,
  }));

  const runPace: WeeklyPacePoint[] = paceRows.map((r) => ({
    weekStart: r.week_start,
    distanceM: r.distance_m,
    movingTimeS: r.moving_time_s,
    isPartialWeek: r.week_start === currentWeekStart,
  }));

  return res.json({ data: { weeks, volumeByType, runPace } });
});

trainingRouter.get("/hr-zones", async (req, res) => {
  const days = Math.min(Math.max(parseInt(String(req.query.days ?? "28")) || 28, 7), 180);

  const [user] = await sql<{ id: string }[]>`SELECT id FROM users LIMIT 1`;
  if (!user) {
    return res.json({
      data: {
        windowDays: days,
        hrMaxEstimate: null,
        zones: [],
        minutesByZone: [],
        totalMinutes: 0,
        activityCount: 0,
        streamsCount: 0,
        coveragePct: null,
      } satisfies HrZoneSummary,
    });
  }

  const hrRows = await sql<{ max_heartrate: number }[]>`
    SELECT max_heartrate FROM activities WHERE user_id = ${user.id} AND max_heartrate IS NOT NULL
  `;
  const hrMaxEstimate = estimateHrMax(hrRows.map((r) => r.max_heartrate));
  const zones = hrMaxEstimate !== null ? buildZoneBoundaries(hrMaxEstimate) : [];

  const activityRows = await sql<{ id: string }[]>`
    SELECT id FROM activities
    WHERE user_id = ${user.id}
      AND (start_date_local AT TIME ZONE 'UTC')::date >= CURRENT_DATE - (${days - 1} || ' days')::INTERVAL
  `;
  const activityCount = activityRows.length;

  // Projects only the two sub-keys needed, never the full streams payload
  // (which also carries up to 9 other arrays) — same rationale as prs.ts's
  // `payload -> 'best_efforts'` projection. Skipped entirely when there's no
  // hrMaxEstimate — with no zone boundaries there's nothing to bucket into.
  const streamRows = activityCount > 0 && zones.length > 0
    ? await sql<{ heartrate_data: unknown; time_data: unknown }[]>`
        SELECT DISTINCT ON (activity_id)
          payload -> 'heartrate' -> 'data' AS heartrate_data,
          payload -> 'time' -> 'data' AS time_data
        FROM activity_dumps
        WHERE activity_id = ANY(${activityRows.map((a) => a.id)}) AND source = 'streams'
        ORDER BY activity_id, fetched_at DESC
      `
    : [];

  let streamsCount = 0;
  let minutesByZone = zones.length > 0 ? bucketTimeInZone([], [], zones).minutesByZone : [];
  let totalMinutes = 0;

  if (zones.length > 0) {
    for (const row of streamRows) {
      const heartrateBpm = parseNumberArray(row.heartrate_data);
      const timeSeconds = parseNumberArray(row.time_data);
      if (!heartrateBpm || !timeSeconds) continue;

      streamsCount++;
      const { minutesByZone: zoneMinutes } = bucketTimeInZone(timeSeconds, heartrateBpm, zones);
      minutesByZone = minutesByZone.map((z, i) => ({ zone: z.zone, minutes: z.minutes + zoneMinutes[i].minutes }));
      totalMinutes += zoneMinutes.reduce((sum, z) => sum + z.minutes, 0);
    }
  }

  const summary: HrZoneSummary = {
    windowDays: days,
    hrMaxEstimate,
    zones,
    minutesByZone,
    totalMinutes,
    activityCount,
    streamsCount,
    coveragePct: activityCount > 0 ? Math.round((streamsCount / activityCount) * 100) : null,
  };

  return res.json({ data: summary });
});

trainingRouter.get("/hr-drift", async (req, res) => {
  const days = Math.min(Math.max(parseInt(String(req.query.days ?? "90")) || 90, 7), 365);
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "30")) || 30, 1), 50);

  const [user] = await sql<{ id: string }[]>`SELECT id FROM users LIMIT 1`;
  if (!user) {
    return res.json({
      data: {
        windowDays: days,
        minMovingTimeS: MIN_DECOUPLING_MOVING_TIME_S,
        qualifyingRunCount: 0,
        streamsCount: 0,
        coveragePct: null,
        runs: [],
      } satisfies HrDriftSummary,
    });
  }

  const runRows = await sql<
    { id: string; name: string; moving_time: number; distance: number; local_date: string }[]
  >`
    SELECT id, name, moving_time, distance, (start_date_local AT TIME ZONE 'UTC')::date::text AS local_date
    FROM activities
    WHERE user_id = ${user.id} AND type = 'Run' AND moving_time >= ${MIN_DECOUPLING_MOVING_TIME_S}
      AND (start_date_local AT TIME ZONE 'UTC')::date >= CURRENT_DATE - (${days - 1} || ' days')::INTERVAL
    ORDER BY start_date_local DESC
    LIMIT ${limit}
  `;
  const qualifyingRunCount = runRows.length;

  const streamRows = qualifyingRunCount > 0
    ? await sql<{ activity_id: string; heartrate_data: unknown; time_data: unknown; distance_data: unknown }[]>`
        SELECT DISTINCT ON (activity_id) activity_id,
          payload -> 'heartrate' -> 'data' AS heartrate_data,
          payload -> 'time' -> 'data' AS time_data,
          payload -> 'distance' -> 'data' AS distance_data
        FROM activity_dumps
        WHERE activity_id = ANY(${runRows.map((r) => r.id)}) AND source = 'streams'
        ORDER BY activity_id, fetched_at DESC
      `
    : [];
  const streamsByActivity = new Map(streamRows.map((r) => [r.activity_id, r]));

  let streamsCount = 0;
  const runs: DecouplingResult[] = [];
  for (const run of runRows) {
    const streams = streamsByActivity.get(run.id);
    const heartrateBpm = streams ? parseNumberArray(streams.heartrate_data) : null;
    const timeSeconds = streams ? parseNumberArray(streams.time_data) : null;
    if (!heartrateBpm || !timeSeconds) continue;

    streamsCount++;
    runs.push(
      computeAerobicDecoupling({
        activityId: run.id,
        activityName: run.name,
        localDate: run.local_date,
        movingTimeS: run.moving_time,
        summaryDistanceM: run.distance,
        timeSeconds,
        heartrateBpm,
        distanceMeters: streams ? parseNumberArray(streams.distance_data) : null,
      }),
    );
  }

  const summary: HrDriftSummary = {
    windowDays: days,
    minMovingTimeS: MIN_DECOUPLING_MOVING_TIME_S,
    qualifyingRunCount,
    streamsCount,
    coveragePct: qualifyingRunCount > 0 ? Math.round((streamsCount / qualifyingRunCount) * 100) : null,
    runs,
  };

  return res.json({ data: summary });
});
