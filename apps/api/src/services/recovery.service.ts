import type { GarminDayPoint, RecoverySummary } from "@goalsplit/types";
import { sql } from "../db/index.js";
import { toGarminDayPoint, type GarminDayRow } from "../lib/garmin.js";
import { addDaysUtc } from "../lib/dates.js";
import { bedtimeConsistency, nextMorningResponse, readiness, restingHrBaseline } from "../lib/recovery.js";
import { buildDailySeries, type LoadInput } from "../lib/training-load.js";
import { activityLoad } from "../lib/trimp.js";
import { getPhysiology, loadAnalyticsActivities } from "./analytics-data.service.js";

const FULL_HISTORY_DAYS = 36_500; // a century: "no lower bound"

// garmin_days for the user, oldest first. `days` limits it to the trailing
// window ending today; omit it for full history.
export async function loadGarminDays(userId: string, days?: number): Promise<GarminDayPoint[]> {
  const rows = await sql<GarminDayRow[]>`
    SELECT day::text AS metric_date, resting_heart_rate, max_heart_rate, min_heart_rate, average_heart_rate,
           avg_stress_level, max_stress_level, body_battery_high, body_battery_low,
           sleep_duration_hours, training_readiness_score, training_readiness_level,
           hrv_last_night_avg, hrv_status, total_steps,
           deep_sleep_seconds, light_sleep_seconds, rem_sleep_seconds, awake_sleep_seconds,
           sleep_start_local, sleep_end_local, sleep_respiration_avg,
           body_battery_charged, body_battery_drained,
           stress_rest_seconds, stress_low_seconds, stress_medium_seconds, stress_high_seconds
    FROM garmin_days
    WHERE user_id = ${userId} AND day >= CURRENT_DATE - ${(days ?? FULL_HISTORY_DAYS) - 1}::int
    ORDER BY day
  `;
  return rows.map(toGarminDayPoint);
}

// Baselines and the next-morning analysis need full history, so everything
// is computed over it and only the resting-HR series is trimmed for display.
export async function getRecoverySummary(userId: string, displayDays: number): Promise<RecoverySummary> {
  const [garminDays, physiology, loaded] = await Promise.all([
    loadGarminDays(userId),
    getPhysiology(userId),
    loadAnalyticsActivities(userId),
  ]);

  const inputs: LoadInput[] = loaded.activities.map((a) => ({
    localDate: a.localDate,
    ...activityLoad(
      { histogram: a.metrics?.hrHistogram ?? null, averageHeartrate: a.averageHeartrate, movingTimeS: a.movingTimeS },
      physiology,
    ),
  }));
  const daily = loaded.firstActivityDate ? buildDailySeries(inputs, loaded.firstActivityDate, loaded.today) : [];

  const rhr = restingHrBaseline(garminDays);
  const displayFrom = addDaysUtc(loaded.today, -(displayDays - 1));
  return {
    restingHr: rhr.filter((p) => p.day >= displayFrom),
    bedtime: bedtimeConsistency(garminDays, loaded.today),
    nextMorning: nextMorningResponse(daily, garminDays, rhr),
    readiness: readiness(garminDays, rhr, daily),
  };
}
