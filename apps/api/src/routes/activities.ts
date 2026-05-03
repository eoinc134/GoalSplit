import { Router } from "express";
import { sql } from "../db/index.js";
import { syncActivities } from "../services/sync.service.js";

export const activitiesRouter = Router();

interface ActivityRow {
  id: string;
  strava_id: number;
  name: string;
  type: string;
  sport_type: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  average_speed: number;
  max_speed: number;
  average_heartrate: number | null;
  max_heartrate: number | null;
  start_date: string;
  start_date_local: string;
  timezone: string;
  synced_at: string;
}

activitiesRouter.get("/", async (req, res) => {
  const type = typeof req.query.type === "string" ? req.query.type : undefined;
  const limit = Math.min(parseInt(String(req.query.limit ?? "50")), 200);
  const offset = parseInt(String(req.query.offset ?? "0"));

  const [user] = await sql<{ id: string }[]>`SELECT id FROM users LIMIT 1`;
  if (!user) return res.json({ data: [], total: 0 });

  const activities = type
    ? await sql<ActivityRow[]>`
        SELECT * FROM activities
        WHERE user_id = ${user.id} AND type = ${type}
        ORDER BY start_date DESC
        LIMIT ${limit} OFFSET ${offset}
      `
    : await sql<ActivityRow[]>`
        SELECT * FROM activities
        WHERE user_id = ${user.id}
        ORDER BY start_date DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

  const [{ count }] = type
    ? await sql<{ count: number }[]>`
        SELECT COUNT(*)::INTEGER AS count FROM activities
        WHERE user_id = ${user.id} AND type = ${type}
      `
    : await sql<{ count: number }[]>`
        SELECT COUNT(*)::INTEGER AS count FROM activities WHERE user_id = ${user.id}
      `;

  return res.json({ data: activities, total: count });
});

activitiesRouter.post("/sync", async (_req, res) => {
  const [user] = await sql<{ id: string }[]>`SELECT id FROM users LIMIT 1`;
  if (!user) {
    return res.status(401).json({ error: "Not connected to Strava", statusCode: 401 });
  }

  try {
    const result = await syncActivities(user.id);
    return res.json({ data: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Sync failed";
    const statusCode = message === "RATE_LIMIT_EXCEEDED" ? 429 : 500;
    return res.status(statusCode).json({ error: message, statusCode });
  }
});
