import { log } from "../lib/logger.js";
import { garminConfigured, runGarminSync } from "./garmin-api.service.js";
import { ensureActivityMetrics } from "./metrics.service.js";
import { isSyncRunning, SyncInProgressError, type SyncTrigger } from "./sync-runs.service.js";

// What follows every Strava sync, whoever started it:
// 1. summarise newly fetched streams now rather than on the next Training-page
//    load (the analytics endpoints still fill any gap lazily);
// 2. refresh Garmin, so one Sync keeps everything current.
// Garmin failures are recorded in sync_runs and shown in the UI's sync
// status, not lost in a background promise.
export async function afterStravaSync(userId: string, trigger: SyncTrigger): Promise<void> {
  try {
    const { computed, pending } = await ensureActivityMetrics(userId);
    if (computed > 0 || pending > 0) log.info("activity metrics computed", { computed, pending });
  } catch (err) {
    log.error("activity metrics precompute failed", { err });
  }

  if (!garminConfigured()) return;
  if (isSyncRunning("garmin", userId)) {
    log.debug("garmin sync already running, skipping follow-up sync");
    return;
  }
  try {
    await runGarminSync(userId, { trigger: trigger === "manual" ? "after_strava" : trigger });
  } catch (err) {
    // Already logged and recorded by trackSyncRun.
    if (err instanceof SyncInProgressError) return;
  }
}
