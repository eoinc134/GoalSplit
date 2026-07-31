import { Router } from "express";
import { sql } from "../db/index.js";
import { syncActivities } from "../services/sync.service.js";
import {
  buildTrainingMarkdown,
  buildTrainingSummary,
  type ActivityDumpPayloads,
} from "../lib/training-export.js";

export const activitiesRouter = Router();

export interface ActivityRow {
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

// Latest 'list' and 'detail' dump per activity, keyed by activity id.
async function fetchDumpsForActivities(
  activityIds: string[],
): Promise<Record<string, ActivityDumpPayloads>> {
  if (activityIds.length === 0) return {};

  const rows = await sql<
    { activity_id: string; source: "list" | "detail"; payload: Record<string, unknown> }[]
  >`
    SELECT DISTINCT ON (activity_id, source) activity_id, source, payload
    FROM activity_dumps
    WHERE activity_id = ANY(${activityIds})
    ORDER BY activity_id, source, fetched_at DESC
  `;

  const dumps: Record<string, ActivityDumpPayloads> = {};
  for (const row of rows) {
    dumps[row.activity_id] ??= {};
    dumps[row.activity_id][row.source] = row.payload;
  }
  return dumps;
}

activitiesRouter.get("/export", async (req, res) => {
  const days = Math.min(Math.max(parseInt(String(req.query.days ?? "30")) || 30, 1), 365);
  const type = typeof req.query.type === "string" ? req.query.type : undefined;
  const format = req.query.format === "markdown" ? "markdown" : "json";

  const [user] = await sql<{ id: string }[]>`SELECT id FROM users LIMIT 1`;
  if (!user) {
    return format === "markdown"
      ? res.type("text/markdown").send(buildTrainingMarkdown([], days))
      : res.json({ data: { summary: buildTrainingSummary([], days), markdown: buildTrainingMarkdown([], days), activities: [] } });
  }

  const activities = type
    ? await sql<ActivityRow[]>`
        SELECT * FROM activities
        WHERE user_id = ${user.id} AND type = ${type}
          AND start_date >= NOW() - (${days} || ' days')::INTERVAL
        ORDER BY start_date DESC
      `
    : await sql<ActivityRow[]>`
        SELECT * FROM activities
        WHERE user_id = ${user.id}
          AND start_date >= NOW() - (${days} || ' days')::INTERVAL
        ORDER BY start_date DESC
      `;

  const dumps = await fetchDumpsForActivities(activities.map((a) => a.id));
  const markdown = buildTrainingMarkdown(activities, days, dumps);

  if (format === "markdown") {
    res.setHeader("Content-Disposition", `attachment; filename="training-export-${days}d.md"`);
    return res.type("text/markdown").send(markdown);
  }

  return res.json({
    data: { summary: buildTrainingSummary(activities, days, dumps), markdown, activities },
  });
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
