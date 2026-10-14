import Database from "better-sqlite3";
import { sql } from "../db/index.js";
import { toGarminDayPoint, type GarminDayRow } from "../lib/garmin.js";
import type { GarminSyncResult } from "@goalsplit/types";

// Garmin sync runs on a home machine, not Railway: Garmin rejects Railway's
// egress IP for every OAuth call. scripts/home-garmin-sync.ps1 runs
// apps/api/scripts/garmy_sync.py to pull Garmin data into a local SQLite file
// (garmy's own "never re-fetch" cache), then scripts/import-garmin-days.ts
// calls this to copy it into Postgres. garmin_days is a derived, rebuildable
// copy of that file.

// Reads garmy's local SQLite cache and upserts every row it finds into
// Postgres — no date filtering, since re-importing a day already in
// Postgres is a harmless no-op (ON CONFLICT DO UPDATE) and this needs to
// work whether the SQLite file was just updated by a fresh sync or has
// months of history sitting in it already.
export async function importGarminDaysFromSqlite(dbPath: string, userId: string): Promise<GarminSyncResult> {
  const db = new Database(dbPath, { readonly: true });
  let rows: GarminDayRow[];
  try {
    rows = db
      .prepare(
        `SELECT metric_date, resting_heart_rate, max_heart_rate, min_heart_rate, average_heart_rate,
                avg_stress_level, max_stress_level, body_battery_high, body_battery_low,
                sleep_duration_hours, training_readiness_score, training_readiness_level,
                hrv_last_night_avg, hrv_status, total_steps
         FROM daily_health_metrics
         ORDER BY metric_date`,
      )
      .all() as GarminDayRow[];
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
