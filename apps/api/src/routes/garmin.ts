import { Router } from "express";
import { sql } from "../db/index.js";
import { getCurrentUserId } from "../services/user.service.js";
import { garminConfigured, runGarminSync } from "../services/garmin-api.service.js";
import { syncErrorResponse } from "./sync-errors.js";
import { getRecoverySummary, loadGarminDays } from "../services/recovery.service.js";
import { notConnected, sendError } from "../lib/api-errors.js";

export const garminRouter = Router();

// A positive integer from a query-string value, or null for anything else
// (absent, repeated, non-numeric).
function positiveInt(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Pulls wellness data from Garmin's official Personal API (see
// services/garmin-api.service.ts). With no ?days, the first sync backfills
// everything since the first Strava activity (resuming if interrupted) and
// later syncs continue from the newest stored day. ?days=N re-syncs the last
// N days.
garminRouter.post("/sync", async (req, res) => {
  const userId = await getCurrentUserId();
  if (!userId) return notConnected(res, "sync Garmin data");
  if (!garminConfigured()) {
    return sendError(res, 412, "GARMIN_NOT_CONFIGURED", "Garmin isn't set up: add a Garmin Personal API key as GARMIN_API");
  }

  try {
    const result = await runGarminSync(userId, { days: positiveInt(req.query.days), trigger: "manual" });
    return res.json({ data: result });
  } catch (err: unknown) {
    const { status, body } = syncErrorResponse(err, "garmin");
    return res.status(status).json(body);
  }
});

garminRouter.get("/days", async (req, res) => {
  const days = Math.min(Math.max(positiveInt(req.query.days) ?? 90, 7), 365);

  const userId = await getCurrentUserId();
  if (!userId) return res.json({ data: { days: [], latestDay: null, lastSyncedAt: null } });

  const garminDays = await loadGarminDays(userId, days);

  const [freshness] = await sql<{ latest_day: string | null; last_synced_at: Date | null }[]>`
    SELECT MAX(day)::text AS latest_day, MAX(synced_at) AS last_synced_at FROM garmin_days WHERE user_id = ${userId}
  `;

  return res.json({
    data: {
      days: garminDays,
      latestDay: freshness?.latest_day ?? null,
      lastSyncedAt: freshness?.last_synced_at ? new Date(freshness.last_synced_at).toISOString() : null,
    },
  });
});

// Recovery analysis: resting HR against your own baseline, bedtime
// consistency, next-morning response to training, and a readiness score.
garminRouter.get("/recovery", async (req, res) => {
  const days = Math.min(Math.max(positiveInt(req.query.days) ?? 90, 7), 365);
  const userId = await getCurrentUserId();
  if (!userId) return res.json({ data: { restingHr: [], bedtime: null, nextMorning: [], readiness: null } });
  return res.json({ data: await getRecoverySummary(userId, days) });
});
