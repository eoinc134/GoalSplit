import { Router } from "express";
import { sql } from "../db/index.js";
import { buildTrainingLoadSummary, type LoadInput } from "../lib/training-load.js";
import { activityLoad } from "../lib/trimp.js";
import { MIN_DECOUPLING_MOVING_TIME_S } from "../lib/hr-zones.js";
import { decoupling } from "../lib/activity-metrics.js";
import { addZoneMinutes, emptyZoneMinutes, summarizeIntensity, zoneMinutesFromHistogram } from "../lib/intensity.js";
import { buildEfficiencySummary } from "../lib/efficiency.js";
import { buildLongRunSummary } from "../lib/long-runs.js";
import { weekSpine } from "../lib/analytics-activity.js";
import { addDaysUtc, weekStartOf } from "../lib/dates.js";
import {
  getCurrentUserId,
  getPhysiology,
  loadAnalyticsActivities,
  physiologyFrom,
  streamsCoveragePct,
  type LoadedActivities,
} from "../services/analytics-data.service.js";
import type {
  WeeklyVolumePoint,
  WeeklyPacePoint,
  HrZoneMinutes,
  HrZoneSummary,
  DecouplingResult,
  HrDriftSummary,
  IntensitySummary,
  WeeklyIntensityPoint,
} from "@goalsplit/types";

// Everything here except /trends reads activity_metrics — a compact,
// grade-adjusted summary of each activity's streams dump (see
// lib/activity-metrics.ts), computed lazily the first time it's needed. Until
// "Backfill History" has fetched streams, those endpoints report a coverage
// figure and return empty series rather than erroring.
export const trainingRouter = Router();

function intParam(raw: unknown, fallback: number, min: number, max: number): number {
  return Math.min(Math.max(parseInt(String(raw ?? fallback)) || fallback, min), max);
}

const NO_PHYSIOLOGY = physiologyFrom({ activityMaxHr: null, garminMaxHr: null, restingMedian: null, sex: null });

function emptyLoaded(): LoadedActivities {
  return { today: new Date().toISOString().slice(0, 10), firstActivityDate: null, activities: [], metricsPending: 0 };
}

async function loadForUser(days?: number, runsOnly = false) {
  const userId = await getCurrentUserId();
  if (!userId) return { physiology: NO_PHYSIOLOGY, loaded: emptyLoaded() };
  const [physiology, loaded] = await Promise.all([
    getPhysiology(userId),
    loadAnalyticsActivities(userId, { days, runsOnly }),
  ]);
  return { physiology, loaded };
}

trainingRouter.get("/load", async (req, res) => {
  const days = intParam(req.query.days, 90, 28, 365);
  // Full history, not just the display window — ATL/CTL are recursive and
  // need everything before the window to start from the right values.
  const { physiology, loaded } = await loadForUser();

  const inputs: LoadInput[] = loaded.activities.map((a) => ({
    localDate: a.localDate,
    ...activityLoad(
      { histogram: a.metrics?.hrHistogram ?? null, averageHeartrate: a.averageHeartrate, movingTimeS: a.movingTimeS },
      physiology,
    ),
  }));

  return res.json({
    data: buildTrainingLoadSummary({
      inputs,
      physiology,
      todayLocal: loaded.today,
      firstActivityLocalDate: loaded.firstActivityDate,
      displayDays: days,
    }),
  });
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
  const days = intParam(req.query.days, 28, 7, 180);
  const { physiology, loaded } = await loadForUser(days);
  const { zones } = physiology;

  let minutesByZone: HrZoneMinutes[] = zones.length > 0 ? emptyZoneMinutes() : [];
  let streamsCount = 0;
  for (const a of loaded.activities) {
    if (!a.metrics?.hasHr || zones.length === 0) continue;
    streamsCount++;
    minutesByZone = addZoneMinutes(minutesByZone, zoneMinutesFromHistogram(a.metrics.hrHistogram, zones));
  }
  const activityCount = loaded.activities.length;

  const summary: HrZoneSummary = {
    windowDays: days,
    hrMaxEstimate: physiology.hrMax,
    zones,
    minutesByZone,
    totalMinutes: minutesByZone.reduce((s, z) => s + z.minutes, 0),
    activityCount,
    streamsCount,
    coveragePct: activityCount > 0 ? Math.round((streamsCount / activityCount) * 100) : null,
    zoneModel: physiology.zoneModel,
    restingHeartRateEstimate: physiology.hrRestSource === "garmin" ? physiology.hrRest : null,
  };
  return res.json({ data: summary });
});

trainingRouter.get("/hr-drift", async (req, res) => {
  const days = intParam(req.query.days, 90, 7, 365);
  const limit = intParam(req.query.limit, 30, 1, 50);
  const { loaded } = await loadForUser(days, true);

  const qualifying = loaded.activities
    .filter((a) => a.movingTimeS >= MIN_DECOUPLING_MOVING_TIME_S)
    .reverse()
    .slice(0, limit);

  const runs: DecouplingResult[] = [];
  for (const a of qualifying) {
    if (!a.metrics?.hasHr) continue;
    const { ef1, ef2, pct } = decoupling(a.metrics);
    runs.push({
      activityId: a.id,
      activityName: a.name,
      localDate: a.localDate,
      movingTimeS: a.movingTimeS,
      ef1,
      ef2,
      decouplingPct: pct,
      usedDistanceFallback: a.metrics.usedDistanceFallback,
    });
  }

  const summary: HrDriftSummary = {
    windowDays: days,
    minMovingTimeS: MIN_DECOUPLING_MOVING_TIME_S,
    qualifyingRunCount: qualifying.length,
    streamsCount: runs.length,
    coveragePct: qualifying.length > 0 ? Math.round((runs.length / qualifying.length) * 100) : null,
    runs,
  };
  return res.json({ data: summary });
});

trainingRouter.get("/intensity", async (req, res) => {
  const weeks = intParam(req.query.weeks, 12, 4, 52);
  // Over-fetch by up to 6 days, then trim to whole calendar weeks once the
  // database's "today" is known.
  const { physiology, loaded } = await loadForUser(weeks * 7 + 6);
  const { zones } = physiology;
  const currentWeek = weekStartOf(loaded.today);
  const windowStart = addDaysUtc(currentWeek, -7 * (weeks - 1));
  const inWindow = loaded.activities.filter((a) => a.localDate >= windowStart);

  const byWeek = new Map<string, HrZoneMinutes[]>();
  for (const a of inWindow) {
    if (!a.metrics?.hasHr || zones.length === 0) continue;
    const wk = weekStartOf(a.localDate);
    byWeek.set(wk, addZoneMinutes(byWeek.get(wk) ?? emptyZoneMinutes(), zoneMinutesFromHistogram(a.metrics.hrHistogram, zones)));
  }

  const weekly: WeeklyIntensityPoint[] = weekSpine(windowStart, loaded.today).map((weekStart) => ({
    weekStart,
    ...summarizeIntensity(byWeek.get(weekStart) ?? emptyZoneMinutes()),
    isPartialWeek: weekStart === currentWeek,
  }));

  const summary: IntensitySummary = {
    weeks,
    zoneModel: physiology.zoneModel,
    weekly,
    overall: summarizeIntensity([...byWeek.values()].reduce(addZoneMinutes, emptyZoneMinutes())),
    streamsCoveragePct: streamsCoveragePct(inWindow),
  };
  return res.json({ data: summary });
});

trainingRouter.get("/efficiency", async (req, res) => {
  const days = intParam(req.query.days, 180, 28, 730);
  const { physiology, loaded } = await loadForUser(days, true);

  return res.json({
    data: buildEfficiencySummary({
      runs: loaded.activities,
      zones: physiology.zones,
      todayLocal: loaded.today,
      windowDays: days,
      streamsCoveragePct: streamsCoveragePct(loaded.activities),
    }),
  });
});

trainingRouter.get("/long-runs", async (req, res) => {
  const days = intParam(req.query.days, 365, 28, 1095);
  const { physiology, loaded } = await loadForUser(days, true);
  return res.json({ data: buildLongRunSummary(loaded.activities, physiology.zones, days) });
});
