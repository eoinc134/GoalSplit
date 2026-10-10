import type { AthletePhysiology } from "@goalsplit/types";
import { sql } from "../db/index.js";
import { METRICS_VERSION, type ActivityMetrics } from "../lib/activity-metrics.js";
import type { AnalyticsActivity } from "../lib/analytics-activity.js";
import { buildZoneBoundaries, buildZoneBoundariesKarvonen, estimateHrMax } from "../lib/hr-zones.js";
import { trimpCoefficientFor } from "../lib/trimp.js";
import { ensureActivityMetrics } from "./metrics.service.js";

// Used for TRIMP when Garmin has never synced a resting HR — a typical adult
// value, surfaced as `hrRestSource: "default"` rather than passed off as measured.
const DEFAULT_HR_REST = 60;

export async function getCurrentUserId(): Promise<string | null> {
  const [user] = await sql<{ id: string }[]>`SELECT id FROM users LIMIT 1`;
  return user?.id ?? null;
}

export function physiologyFrom(input: {
  activityMaxHr: number | null;
  garminMaxHr: number | null;
  restingMedian: number | null;
  sex: string | null;
}): AthletePhysiology {
  const hrMax = estimateHrMax([input.activityMaxHr ?? 0, input.garminMaxHr ?? 0]);
  const hrRest = input.restingMedian !== null ? Math.round(input.restingMedian) : DEFAULT_HR_REST;
  const hrRestSource = input.restingMedian !== null ? "garmin" : "default";
  const sex = input.sex === "M" || input.sex === "F" ? input.sex : null;
  const zoneModel = hrRestSource === "garmin" ? "karvonen" : "percent-max";
  let zones: AthletePhysiology["zones"] = [];
  if (hrMax !== null) zones = zoneModel === "karvonen" ? buildZoneBoundariesKarvonen(hrMax, hrRest) : buildZoneBoundaries(hrMax);
  return { hrMax, hrRest, hrRestSource, sex, trimpCoefficient: trimpCoefficientFor(sex), zoneModel, zones };
}

// HRmax: highest HR ever seen, Strava or Garmin all-day (Garmin can catch a
// spike no logged activity did). HRrest: median of the 90 days up to the
// latest Garmin reading — a single morning's value is too noisy to anchor
// every zone and TRIMP on.
export async function getPhysiology(userId: string): Promise<AthletePhysiology> {
  const [row] = await sql<
    { activity_max: number | null; garmin_max: number | null; resting_median: number | null; sex: string | null }[]
  >`
    SELECT
      (SELECT MAX(max_heartrate) FROM activities WHERE user_id = ${userId}) AS activity_max,
      (SELECT MAX(max_heart_rate) FROM garmin_days WHERE user_id = ${userId}) AS garmin_max,
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY resting_heart_rate)
         FROM garmin_days
         WHERE user_id = ${userId} AND resting_heart_rate IS NOT NULL
           AND day > (SELECT MAX(day) FROM garmin_days WHERE user_id = ${userId} AND resting_heart_rate IS NOT NULL) - 90
      ) AS resting_median,
      (SELECT sex FROM users WHERE id = ${userId}) AS sex
  `;
  return physiologyFrom({
    activityMaxHr: row?.activity_max ?? null,
    garminMaxHr: row?.garmin_max ?? null,
    restingMedian: row?.resting_median ?? null,
    sex: row?.sex ?? null,
  });
}

export interface LoadActivitiesOptions {
  days?: number; // trailing local days including today; omit for full history
  runsOnly?: boolean;
}

export interface LoadedActivities {
  today: string;
  firstActivityDate: string | null;
  activities: AnalyticsActivity[]; // oldest first
  metricsPending: number;
}

export async function loadAnalyticsActivities(userId: string, opts: LoadActivitiesOptions = {}): Promise<LoadedActivities> {
  const { pending } = await ensureActivityMetrics(userId);

  const [bounds] = await sql<{ today: string; first_date: string | null }[]>`
    SELECT CURRENT_DATE::text AS today,
           MIN((start_date_local AT TIME ZONE 'UTC')::date)::text AS first_date
    FROM activities WHERE user_id = ${userId}
  `;

  // start_date_local is a local wall-clock reading stored with a UTC label
  // (Strava convention) — AT TIME ZONE 'UTC' reads it back losslessly.
  const rows = await sql<
    {
      id: string;
      name: string;
      type: string;
      local_date: string;
      moving_time: number;
      distance: number;
      total_elevation_gain: number;
      average_heartrate: number | null;
      workout_type: number | null;
      is_week_longest: boolean;
      metrics: ActivityMetrics | null;
    }[]
  >`
    SELECT a.id, a.name, a.type,
      (a.start_date_local AT TIME ZONE 'UTC')::date::text AS local_date,
      a.moving_time, a.distance, a.total_elevation_gain, a.average_heartrate,
      (SELECT (d.payload ->> 'workout_type')::int FROM activity_dumps d
         WHERE d.activity_id = a.id AND d.source = 'list'
         ORDER BY d.fetched_at DESC LIMIT 1) AS workout_type,
      (a.type = 'Run' AND ROW_NUMBER() OVER (
         PARTITION BY a.type, date_trunc('week', a.start_date_local AT TIME ZONE 'UTC')
         ORDER BY a.moving_time DESC) = 1) AS is_week_longest,
      m.metrics
    FROM activities a
    LEFT JOIN activity_metrics m ON m.activity_id = a.id AND m.version = ${METRICS_VERSION}
    WHERE a.user_id = ${userId}
      ${opts.days !== undefined ? sql`AND (a.start_date_local AT TIME ZONE 'UTC')::date >= CURRENT_DATE - ${opts.days - 1}::int` : sql``}
      ${opts.runsOnly ? sql`AND a.type = 'Run'` : sql``}
    ORDER BY a.start_date_local
  `;

  return {
    today: bounds.today,
    firstActivityDate: bounds.first_date,
    metricsPending: pending,
    activities: rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      localDate: r.local_date,
      movingTimeS: r.moving_time,
      distanceM: r.distance,
      elevationGainM: r.total_elevation_gain,
      averageHeartrate: r.average_heartrate,
      workoutType: r.workout_type,
      isWeekLongest: r.is_week_longest,
      metrics: r.metrics,
    })),
  };
}

export function streamsCoveragePct(activities: AnalyticsActivity[]): number | null {
  if (activities.length === 0) return null;
  return Math.round((activities.filter((a) => a.metrics !== null).length / activities.length) * 100);
}
