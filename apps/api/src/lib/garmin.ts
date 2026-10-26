import type { GarminDayPoint } from "@goalsplit/types";

// A garmin_days row as selected by GET /api/garmin/days (snake_case columns).
export interface GarminDayRow {
  metric_date: string;
  resting_heart_rate: number | null;
  max_heart_rate: number | null;
  min_heart_rate: number | null;
  average_heart_rate: number | null;
  avg_stress_level: number | null;
  max_stress_level: number | null;
  body_battery_high: number | null;
  body_battery_low: number | null;
  sleep_duration_hours: number | null;
  training_readiness_score: number | null;
  training_readiness_level: string | null;
  hrv_last_night_avg: number | null;
  hrv_status: string | null;
  total_steps: number | null;
  deep_sleep_seconds: number | null;
  light_sleep_seconds: number | null;
  rem_sleep_seconds: number | null;
  awake_sleep_seconds: number | null;
  sleep_start_local: string | null;
  sleep_end_local: string | null;
  sleep_respiration_avg: number | null;
  body_battery_charged: number | null;
  body_battery_drained: number | null;
  stress_rest_seconds: number | null;
  stress_low_seconds: number | null;
  stress_medium_seconds: number | null;
  stress_high_seconds: number | null;
}


// snake_case (database columns) -> camelCase (this app's wire format).
// Missing metrics (e.g. a night without sleep data) stay null — never defaulted.
export function toGarminDayPoint(row: GarminDayRow): GarminDayPoint {
  return {
    day: row.metric_date,
    restingHeartRate: row.resting_heart_rate,
    maxHeartRate: row.max_heart_rate,
    minHeartRate: row.min_heart_rate,
    averageHeartRate: row.average_heart_rate,
    avgStressLevel: row.avg_stress_level,
    maxStressLevel: row.max_stress_level,
    bodyBatteryHigh: row.body_battery_high,
    bodyBatteryLow: row.body_battery_low,
    sleepDurationHours: row.sleep_duration_hours,
    trainingReadinessScore: row.training_readiness_score,
    trainingReadinessLevel: row.training_readiness_level,
    hrvLastNightAvg: row.hrv_last_night_avg,
    hrvStatus: row.hrv_status,
    totalSteps: row.total_steps,
    deepSleepSeconds: row.deep_sleep_seconds,
    lightSleepSeconds: row.light_sleep_seconds,
    remSleepSeconds: row.rem_sleep_seconds,
    awakeSleepSeconds: row.awake_sleep_seconds,
    sleepStartLocal: row.sleep_start_local,
    sleepEndLocal: row.sleep_end_local,
    sleepRespirationAvg: row.sleep_respiration_avg,
    bodyBatteryCharged: row.body_battery_charged,
    bodyBatteryDrained: row.body_battery_drained,
    stressRestSeconds: row.stress_rest_seconds,
    stressLowSeconds: row.stress_low_seconds,
    stressMediumSeconds: row.stress_medium_seconds,
    stressHighSeconds: row.stress_high_seconds,
  };
}
