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
import { afterStravaSync } from "../services/pipeline.service.js";
import { syncErrorResponse } from "./sync-errors.js";
import { analyseActivities } from "../services/analytics-data.service.js";
import { intParam, notConnected, notFound } from "../lib/api-errors.js";
import type { ActivityRow, ApiList } from "@goalsplit/types";

export const activitiesRouter = Router();

// Exactly the columns of the shared ActivityRow type — never `SELECT *`, so
// internal columns (user_id, streams_missing) don't leak into responses.
// Built once and reused by each query (checked against real Postgres: a
// postgres.js fragment can be embedded in any number of queries).
const ACTIVITY_COLUMNS = sql`
  id, strava_id, name, type, sport_type, distance, moving_time, elapsed_time,
  total_elevation_gain, average_speed, max_speed, average_heartrate, max_heartrate,
  start_date, start_date_local, timezone, synced_at
`;

activitiesRouter.get("/", async (req, res) => {
  const type = typeof req.query.type === "string" && req.query.type !== "" ? req.query.type : undefined;
  const limit = intParam(req.query.limit, 50, 1, 200);
  const offset = intParam(req.query.offset, 0, 0, 1_000_000);

  const userId = await getCurrentUserId();
  if (!userId) return res.json({ data: [], total: 0 } satisfies ApiList<ActivityRow>);

  const typeFilter = type ? sql`AND type = ${type}` : sql``;
  const activities = await sql<ActivityRow[]>`
    SELECT ${ACTIVITY_COLUMNS} FROM activities
    WHERE user_id = ${userId} ${typeFilter}
    ORDER BY start_date DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  const [{ count }] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::INTEGER AS count FROM activities WHERE user_id = ${userId} ${typeFilter}
  `;

  return res.json({ data: activities, total: count } satisfies ApiList<ActivityRow>);
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
        SELECT ${ACTIVITY_COLUMNS} FROM activities
        WHERE user_id = ${userId} AND type = ${type}
          AND start_date >= NOW() - (${days} || ' days')::INTERVAL
        ORDER BY start_date DESC
      `
    : await sql<ActivityRow[]>`
        SELECT ${ACTIVITY_COLUMNS} FROM activities
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

// Incremental sync (new activities + the last week re-read, plus a bounded
// repair of activities missing detail/streams) or, with ?full=true, a full
// history walk. Responds with complete: false and a stopReason when Strava's
// rate limit cut it short — everything fetched so far is kept.
activitiesRouter.post("/sync", async (req, res) => {
  const userId = await getCurrentUserId();
  if (!userId) {
    return notConnected(res, "sync activities");
  }

  try {
    const result = await syncActivities(userId, { full: req.query.full === "true", trigger: "manual" });
    // Not awaited — metrics and Garmin can take a while; the outcome lands in
    // sync_runs (GET /api/sync/status).
    void afterStravaSync(userId, "manual");
    return res.json({ data: result });
  } catch (err: unknown) {
    const { status, body } = syncErrorResponse(err, "strava");
    return res.status(status).json(body);
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
  if (!userId) return notFound(res, "Activity not found");

  const [activity] = await sql<ActivityRow[]>`
    SELECT ${ACTIVITY_COLUMNS} FROM activities WHERE id = ${req.params.id} AND user_id = ${userId}
  `;
  if (!activity) return notFound(res, "Activity not found");

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
