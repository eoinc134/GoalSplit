import { Router } from "express";
import { sql } from "../db/index.js";
import { syncActivities } from "../services/sync.service.js";
import {
  buildTrainingMarkdown,
  buildTrainingSummary,
  buildActivityNote,
  type ActivityDumpPayloads,
} from "../lib/training-export.js";
import { buildActivityRoutes, type RoutePolylineRow } from "../lib/polyline.js";

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

// GET /activities/routes — decoded route polylines for every synced activity
// that has GPS data. Uses the `list` dump only, not `detail`: `list` is
// written on every sync (including the routine incremental one), so it's
// already the "zero backfill dependency" source; `detail` is a strict
// coverage subset (only backfilled/new activities), so checking both would
// add cost for zero additional coverage. Not date-windowed — a route can come
// from any point in history, same precedent as the PRs endpoint.
activitiesRouter.get("/routes", async (_req, res) => {
  const [user] = await sql<{ id: string }[]>`SELECT id FROM users LIMIT 1`;
  if (!user) return res.json({ data: { routes: [] } });

  const activityRows = await sql<{ id: string; name: string; type: string; local_date: string }[]>`
    SELECT id, name, type, (start_date_local AT TIME ZONE 'UTC')::date::text AS local_date
    FROM activities WHERE user_id = ${user.id} ORDER BY start_date_local DESC
  `;

  const ids = activityRows.map((a) => a.id);
  const polylineRows = ids.length
    ? await sql<{ activity_id: string; summary_polyline: string | null }[]>`
        SELECT DISTINCT ON (activity_id) activity_id,
               payload -> 'map' ->> 'summary_polyline' AS summary_polyline
        FROM activity_dumps
        WHERE activity_id = ANY(${ids}) AND source = 'list'
        ORDER BY activity_id, fetched_at DESC
      `
    : [];

  const polylineByActivity = new Map(polylineRows.map((r) => [r.activity_id, r.summary_polyline]));
  const rows: RoutePolylineRow[] = activityRows.map((a) => ({
    activity_id: a.id,
    activity_name: a.name,
    type: a.type,
    local_date: a.local_date,
    summary_polyline: polylineByActivity.get(a.id) ?? null,
  }));

  return res.json({ data: { routes: buildActivityRoutes(rows) } });
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

activitiesRouter.post("/sync", async (req, res) => {
  const [user] = await sql<{ id: string }[]>`SELECT id FROM users LIMIT 1`;
  if (!user) {
    return res.status(401).json({ error: "Not connected to Strava", statusCode: 401 });
  }

  try {
    const full = req.query.full === "true";
    const result = await syncActivities(user.id, { full });
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
  const [user] = await sql<{ id: string }[]>`SELECT id FROM users LIMIT 1`;
  if (!user) return res.status(404).json({ error: "Not found", statusCode: 404 });

  const [activity] = await sql<ActivityRow[]>`
    SELECT * FROM activities WHERE id = ${req.params.id} AND user_id = ${user.id}
  `;
  if (!activity) return res.status(404).json({ error: "Not found", statusCode: 404 });

  const dumps = await fetchDumpsForActivities([activity.id]);
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
      notes: buildActivityNote(activity, activityDumps),
    },
  });
});
