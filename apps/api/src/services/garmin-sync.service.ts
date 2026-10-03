import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import { sql } from "../db/index.js";
import { validateGarminConfig, toGarminDayPoint, type GarminDayRow } from "../lib/garmin.js";
import type { GarminSyncResult } from "@goalsplit/types";

const execFileAsync = promisify(execFile);

// garmy-sync handles Garmin's own (reverse-engineered) auth, incremental sync,
// and conflict resolution into its own SQLite file — this never talks to
// Garmin's API directly. We only read the result back out.
export async function syncGarminDays(userId: string, days: number): Promise<GarminSyncResult> {
  const config = validateGarminConfig();
  if (!config) throw new Error("GARMIN_NOT_CONFIGURED");

  try {
    await execFileAsync("garmy-sync", ["sync", "--last-days", String(days)], {
      env: {
        ...process.env,
        GARMIN_EMAIL: config.email,
        GARMIN_PASSWORD: config.password,
        GARMY_DB_PATH: config.dbPath,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`GARMIN_SYNC_FAILED: ${message}`);
  }

  const db = new Database(config.dbPath, { readonly: true });
  let rows: GarminDayRow[];
  try {
    rows = db
      .prepare(
        `SELECT metric_date, resting_heart_rate, max_heart_rate, min_heart_rate, average_heart_rate,
                avg_stress_level, max_stress_level, body_battery_high, body_battery_low,
                sleep_duration_hours, training_readiness_score, training_readiness_level,
                hrv_last_night_avg, hrv_status, total_steps
         FROM daily_health_metrics
         WHERE metric_date >= date('now', ?)
         ORDER BY metric_date`,
      )
      .all(`-${days} days`) as GarminDayRow[];
  } finally {
    db.close();
  }

  for (const row of rows) {
    const point = toGarminDayPoint(row);
    await sql`
      INSERT INTO garmin_days (
        id, user_id, day, resting_heart_rate, max_heart_rate, min_heart_rate, average_heart_rate,
        avg_stress_level, max_stress_level, body_battery_high, body_battery_low,
        sleep_duration_hours, training_readiness_score, training_readiness_level,
        hrv_last_night_avg, hrv_status, total_steps
      ) VALUES (
        ${crypto.randomUUID()}, ${userId}, ${point.day}, ${point.restingHeartRate}, ${point.maxHeartRate},
        ${point.minHeartRate}, ${point.averageHeartRate}, ${point.avgStressLevel}, ${point.maxStressLevel},
        ${point.bodyBatteryHigh}, ${point.bodyBatteryLow}, ${point.sleepDurationHours},
        ${point.trainingReadinessScore}, ${point.trainingReadinessLevel}, ${point.hrvLastNightAvg},
        ${point.hrvStatus}, ${point.totalSteps}
      )
      ON CONFLICT (user_id, day) DO UPDATE SET
        resting_heart_rate       = EXCLUDED.resting_heart_rate,
        max_heart_rate            = EXCLUDED.max_heart_rate,
        min_heart_rate            = EXCLUDED.min_heart_rate,
        average_heart_rate        = EXCLUDED.average_heart_rate,
        avg_stress_level          = EXCLUDED.avg_stress_level,
        max_stress_level          = EXCLUDED.max_stress_level,
        body_battery_high         = EXCLUDED.body_battery_high,
        body_battery_low          = EXCLUDED.body_battery_low,
        sleep_duration_hours       = EXCLUDED.sleep_duration_hours,
        training_readiness_score  = EXCLUDED.training_readiness_score,
        training_readiness_level  = EXCLUDED.training_readiness_level,
        hrv_last_night_avg        = EXCLUDED.hrv_last_night_avg,
        hrv_status                = EXCLUDED.hrv_status,
        total_steps               = EXCLUDED.total_steps,
        synced_at                 = NOW()
    `;
  }

  return { synced: rows.length };
}
