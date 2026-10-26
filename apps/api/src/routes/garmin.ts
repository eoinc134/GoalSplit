import { Router } from "express";
import { sql } from "../db/index.js";
import { addDaysUtc } from "../lib/dates.js";
import { getCurrentUserId } from "../services/user.service.js";
import { defaultSyncRange, garminConfigured, syncGarmin } from "../services/garmin-api.service.js";
import { getRecoverySummary, loadGarminDays } from "../services/recovery.service.js";

export const garminRouter = Router();

// A positive integer from a query-string value, or null for anything else
// (absent, repeated, non-numeric).
function positiveInt(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Pulls wellness data from Garmin's official Personal API (see
// services/garmin-api.service.ts). With no ?days, the first sync backfills
// everything since the first Strava activity and later syncs re-read the last
// week. ?days=N re-syncs the last N days.
garminRouter.post("/sync", async (req, res) => {
  const userId = await getCurrentUserId();
  if (!userId) return res.status(401).json({ error: "Connect Strava before syncing Garmin data", statusCode: 401 });
  if (!garminConfigured()) {
    return res.status(412).json({ error: "Set GARMIN_API (a Garmin Personal API key) in apps/api/.env", statusCode: 412 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const requested = positiveInt(req.query.days);
  const range = requested === null
    ? await defaultSyncRange(userId, today)
    : { start: addDaysUtc(today, -(Math.min(requested, 1100) - 1)), end: today };

  try {
    const result = await syncGarmin(userId, range.start, range.end);
    return res.json({ data: { ...result, ...range } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Garmin sync failed";
    if (message === "GARMIN_KEY_REJECTED") {
      return res.status(401).json({
        error: "Garmin rejected the API key. It may have expired: create a new one in Garmin Connect → Personal API Key",
        statusCode: 401,
      });
    }
    return res.status(502).json({ error: message, statusCode: 502 });
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
