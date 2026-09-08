import { Router } from "express";
import { sql } from "../db/index.js";
import {
  buildTrainingLoadSummary,
  type ActivityLoadInput,
  type ListPayloadByActivityId,
} from "../lib/training-load.js";
import type { WeeklyVolumePoint, WeeklyPacePoint } from "@goalsplit/types";

// Phase 2 (not built here): HR-zone time, grade-adjusted pace, HR drift, power
// curves — all need the `streams` dump (backfill not run against real data yet)
// and Strava's /athlete/zones (not ingested at all). This route only reads
// `activities` and `list` dumps, both already fully populated by every sync.
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
