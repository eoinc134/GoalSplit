import { Router } from "express";
import { sql } from "../db/index.js";
import { toGarminDayPoint, type GarminDayRow } from "../lib/garmin.js";
import { getCurrentUserId } from "../services/user.service.js";

// Read-only: garmin_days is filled by the home-machine sync
// (scripts/home-garmin-sync.ps1), since Garmin blocks Railway's IP.
export const garminRouter = Router();

garminRouter.get("/days", async (req, res) => {
  const days = Math.min(Math.max(parseInt(String(req.query.days ?? "90")) || 90, 7), 365);

  const userId = await getCurrentUserId();
  if (!userId) return res.json({ data: { days: [] } });

  const rows = await sql<GarminDayRow[]>`
    SELECT day::text AS metric_date, resting_heart_rate, max_heart_rate, min_heart_rate, average_heart_rate,
           avg_stress_level, max_stress_level, body_battery_high, body_battery_low,
           sleep_duration_hours, training_readiness_score, training_readiness_level,
           hrv_last_night_avg, hrv_status, total_steps
    FROM garmin_days
    WHERE user_id = ${userId} AND day >= CURRENT_DATE - (${days - 1} || ' days')::INTERVAL
    ORDER BY day
  `;

  return res.json({ data: { days: rows.map(toGarminDayPoint) } });
});
