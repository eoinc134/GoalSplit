import type { GarminDayPoint } from "@goalsplit/types";

// Column names exactly as garmy's `daily_health_metrics` SQLite table names them —
// see docs/database-schema.md in https://github.com/bes-dev/garmy.
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
}

// snake_case (garmy's SQLite columns) -> camelCase (this app's wire format).
// SQLite returns null for any metric that hasn't gathered enough data yet
// (e.g. a day without an HRV reading) — passed through as-is, never defaulted.
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
  };
}

export interface GarminConfig {
  email: string;
  password: string;
  dbPath: string;
}

// Pure read of process.env — lets the route/service fail fast with a clear
// "not configured" message instead of a cryptic garmy-sync spawn error.
export function validateGarminConfig(env: NodeJS.ProcessEnv = process.env): GarminConfig | null {
  const email = env.GARMIN_EMAIL;
  const password = env.GARMIN_PASSWORD;
  const dbPath = env.GARMY_DB_PATH;
  if (!email || !password || !dbPath) return null;
  return { email, password, dbPath };
}
