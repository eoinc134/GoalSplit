import { Router } from "express";
import { sql } from "../db/index.js";
import { syncGarminDays } from "../services/garmin-sync.service.js";
import { toGarminDayPoint, type GarminDayRow } from "../lib/garmin.js";

export const garminRouter = Router();

garminRouter.post("/sync", async (req, res) => {
  const [user] = await sql<{ id: string }[]>`SELECT id FROM users LIMIT 1`;
  if (!user) {
    return res.status(401).json({ error: "Connect Strava before syncing Garmin data", statusCode: 401 });
  }

  const days = Math.min(Math.max(parseInt(String(req.query.days ?? "7")) || 7, 1), 365);

  try {
    const result = await syncGarminDays(user.id, days);
    return res.json({ data: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Garmin sync failed";
    if (message === "GARMIN_NOT_CONFIGURED") {
      return res.status(412).json({
        error: "Set GARMIN_EMAIL, GARMIN_PASSWORD, and GARMY_DB_PATH in apps/api/.env",
        statusCode: 412,
      });
    }
    return res.status(500).json({ error: message, statusCode: 500 });
  }
});

garminRouter.get("/days", async (req, res) => {
  const days = Math.min(Math.max(parseInt(String(req.query.days ?? "90")) || 90, 7), 365);

  const [user] = await sql<{ id: string }[]>`SELECT id FROM users LIMIT 1`;
  if (!user) return res.json({ data: { days: [] } });

  const rows = await sql<GarminDayRow[]>`
    SELECT day::text AS metric_date, resting_heart_rate, max_heart_rate, min_heart_rate, average_heart_rate,
           avg_stress_level, max_stress_level, body_battery_high, body_battery_low,
           sleep_duration_hours, training_readiness_score, training_readiness_level,
           hrv_last_night_avg, hrv_status, total_steps
    FROM garmin_days
    WHERE user_id = ${user.id} AND day >= CURRENT_DATE - (${days - 1} || ' days')::INTERVAL
    ORDER BY day
  `;

  return res.json({ data: { days: rows.map(toGarminDayPoint) } });
});
