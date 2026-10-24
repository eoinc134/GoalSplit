import { Router } from "express";
import { sql } from "../db/index.js";
import { syncActivities } from "../services/sync.service.js";
import {
  buildTrainingMarkdown,
  buildTrainingSummary,
  buildActivityNote,
  type ActivityDumpPayloads,
} from "../lib/training-export.js";
import { buildActivityRoutes } from "../lib/polyline.js";
import { getCurrentUserId } from "../services/user.service.js";
import { ensureActivityMetrics } from "../services/metrics.service.js";
import { defaultSyncRange, garminConfigured, syncGarmin } from "../services/garmin-api.service.js";
import { analyseActivities } from "../services/analytics-data.service.js";

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

  const userId = await getCurrentUserId();
  if (!userId) return res.json({ data: [], total: 0 });

  const activities = type
    ? await sql<ActivityRow[]>`
        SELECT * FROM activities
        WHERE user_id = ${userId} AND type = ${type}
        ORDER BY start_date DESC
        LIMIT ${limit} OFFSET ${offset}
      `
    : await sql<ActivityRow[]>`
        SELECT * FROM activities
        WHERE user_id = ${userId}
        ORDER BY start_date DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

  const [{ count }] = type
    ? await sql<{ count: number }[]>`
        SELECT COUNT(*)::INTEGER AS count FROM activities
        WHERE user_id = ${userId} AND type = ${type}
      `
    : await sql<{ count: number }[]>`
        SELECT COUNT(*)::INTEGER AS count FROM activities WHERE user_id = ${userId}
      `;

  return res.json({ data: activities, total: count });
});

// Latest 'list' and 'detail' dump per activity, keyed by activity id.
async function fetchDumpsForActivities(
  activityIds: string[],
): Promise<Record<string, ActivityDumpPayloads>> {
  if (activityIds.length === 0) return {};

  // Excludes 'streams' — those payloads can be large and aren't used by the
  // markdown/JSON training export, only by future time-series analytics.
  const rows = await sql<
    { activity_id: string; source: "list" | "detail"; payload: Record<string, unknown> }[]
  >`
    SELECT DISTINCT ON (activity_id, source) activity_id, source, payload
    FROM activity_dumps
    WHERE activity_id = ANY(${activityIds}) AND source IN ('list', 'detail')
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

  const userId = await getCurrentUserId();
  if (!userId) {
    return format === "markdown"
      ? res.type("text/markdown").send(buildTrainingMarkdown([], days))
      : res.json({ data: { summary: buildTrainingSummary([], days), markdown: buildTrainingMarkdown([], days), activities: [] } });
  }

  const activities = type
    ? await sql<ActivityRow[]>`
        SELECT * FROM activities
        WHERE user_id = ${userId} AND type = ${type}
          AND start_date >= NOW() - (${days} || ' days')::INTERVAL
        ORDER BY start_date DESC
      `
    : await sql<ActivityRow[]>`
        SELECT * FROM activities
        WHERE user_id = ${userId}
          AND start_date >= NOW() - (${days} || ' days')::INTERVAL
        ORDER BY start_date DESC
      `;

  // One extra day so a run on the window's first local day isn't missed at
  // the local-date vs UTC-timestamp boundary.
  const [dumps, analysis] = await Promise.all([
    fetchDumpsForActivities(activities.map((a) => a.id)),
    analyseActivities(userId, days + 1),
  ]);
  const markdown = buildTrainingMarkdown(activities, days, dumps, analysis);

  if (format === "markdown") {
    res.setHeader("Content-Disposition", `attachment; filename="training-export-${days}d.md"`);
    return res.type("text/markdown").send(markdown);
  }

  return res.json({
    data: { summary: buildTrainingSummary(activities, days, analysis), markdown, activities },
  });
});

activitiesRouter.post("/sync", async (req, res) => {
  const userId = await getCurrentUserId();
  if (!userId) {
    return res.status(401).json({ error: "Not connected to Strava", statusCode: 401 });
  }

  try {
    const full = req.query.full === "true";
    const result = await syncActivities(userId, { full });
    // Summarise any newly fetched streams now rather than on the next
    // Training-page load. Not awaited — a long backfill can take a while, and
    // the analytics endpoints still fill any gap lazily if this hasn't finished.
    ensureActivityMetrics(userId).catch((err: unknown) => console.error("Metrics precompute failed:", err));
    // Refresh Garmin wellness data alongside, so one Sync keeps everything current.
    if (garminConfigured()) {
      const today = new Date().toISOString().slice(0, 10);
      defaultSyncRange(userId, today)
        .then(({ start, end }) => syncGarmin(userId, start, end))
        .catch((err: unknown) => console.error("Garmin sync failed:", err));
    }
    return res.json({ data: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Sync failed";
    const statusCode = message === "RATE_LIMIT_EXCEEDED" ? 429 : 500;
    return res.status(statusCode).json({ error: message, statusCode });
  }
});

// GET /activities/:id — a single activity's full detail: the flattened row,
// its decoded route (if it has GPS data), and a formatted notes block reusing
// the same workout-type/effort/cadence/description/splits/best-efforts
// rendering already built for the Claude export (buildActivityNote). Registered
// last so this param route never shadows the literal /routes and /export paths
// above it — Express matches GET routes in registration order.
activitiesRouter.get("/:id", async (req, res) => {
  const userId = await getCurrentUserId();
  if (!userId) return res.status(404).json({ error: "Not found", statusCode: 404 });

  const [activity] = await sql<ActivityRow[]>`
    SELECT * FROM activities WHERE id = ${req.params.id} AND user_id = ${userId}
  `;
  if (!activity) return res.status(404).json({ error: "Not found", statusCode: 404 });

  const [dumps, analysis] = await Promise.all([fetchDumpsForActivities([activity.id]), analyseActivities(userId)]);
  const activityDumps = dumps[activity.id];

  const routes = buildActivityRoutes([
    {
      activity_id: activity.id,
      activity_name: activity.name,
      type: activity.type,
      local_date: new Date(activity.start_date_local).toISOString().slice(0, 10),
      summary_polyline: (activityDumps?.list?.map as { summary_polyline?: string } | undefined)?.summary_polyline ?? null,
    },
  ]);

  return res.json({
    data: {
      ...activity,
      route: routes[0]?.points ?? null,
      notes: buildActivityNote(activity, activityDumps, analysis[activity.id]),
    },
  });
});
