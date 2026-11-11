import { Router } from "express";
import type { SyncRunSummary, SyncSourceStatus, SyncStatusResponse } from "@goalsplit/types";
import { getCurrentUserId } from "../services/user.service.js";
import { garminConfigured } from "../services/garmin-api.service.js";
import { countMissingEnrichment } from "../services/sync.service.js";
import { isSyncRunning, latestRuns, type SyncRunRow, type SyncSource } from "../services/sync-runs.service.js";
import { scheduleInfo } from "../services/scheduler.js";

// Pipeline health for the UI: the latest run per source, the last one that
// succeeded, recent history, and how much Strava enrichment is outstanding.
export const syncRouter = Router();

function toSummary(row: SyncRunRow): SyncRunSummary {
  const details = row.details ?? {};
  return {
    id: row.id,
    mode: row.mode,
    trigger: row.trigger,
    status: row.status,
    startedAt: new Date(row.started_at).toISOString(),
    finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
    items: row.items,
    error: row.error,
    stopReason: typeof details.stopReason === "string" ? details.stopReason : null,
  };
}

async function sourceStatus(userId: string, source: SyncSource): Promise<SyncSourceStatus> {
  const runs = await latestRuns(userId, source, 10);
  const lastSuccess = runs.find((r) => r.status === "ok" || r.status === "partial");
  return {
    running: isSyncRunning(source, userId),
    last: runs[0] ? toSummary(runs[0]) : null,
    lastSuccess: lastSuccess ? toSummary(lastSuccess) : null,
    recent: runs.map(toSummary),
  };
}

syncRouter.get("/status", async (_req, res) => {
  const userId = await getCurrentUserId();
  if (!userId) return res.status(404).json({ error: "No athlete connected", statusCode: 404 });

  const [strava, garmin, pendingEnrichment] = await Promise.all([
    sourceStatus(userId, "strava"),
    sourceStatus(userId, "garmin"),
    countMissingEnrichment(userId),
  ]);

  const data: SyncStatusResponse = {
    strava: { ...strava, pendingEnrichment },
    garmin: { ...garmin, configured: garminConfigured() },
    schedule: scheduleInfo(),
  };
  return res.json({ data });
});
