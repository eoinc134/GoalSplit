import { log } from "../lib/logger.js";
import { getStoredToken } from "./token.service.js";
import { getCurrentUserId } from "./user.service.js";
import { syncActivities } from "./sync.service.js";
import { afterStravaSync } from "./pipeline.service.js";
import { isSyncRunning, SyncInProgressError } from "./sync-runs.service.js";

// Keeps data current without anyone clicking Sync: every
// SYNC_INTERVAL_MINUTES (default 360 = 6 h; 0 disables) runs an incremental
// Strava sync followed by the usual metrics + Garmin step. When nothing is
// new that's 1–3 Strava requests. The first run waits FIRST_RUN_DELAY_MS
// after boot so a crash-looping deploy can't hammer Strava.
//
// In-process timer: fine for a single always-on Railway instance. The
// timer is unref'd so it never keeps a shutting-down process alive.

const DEFAULT_INTERVAL_MINUTES = 360;
const FIRST_RUN_DELAY_MS = 2 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let nextRunAt: Date | null = null;

export function scheduleIntervalMinutes(): number {
  const raw = process.env.SYNC_INTERVAL_MINUTES;
  if (raw === undefined || raw === "") return DEFAULT_INTERVAL_MINUTES;
  const minutes = Number(raw);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : DEFAULT_INTERVAL_MINUTES;
}

export function scheduleInfo(): { intervalMinutes: number; nextRunAt: string | null } {
  return { intervalMinutes: scheduleIntervalMinutes(), nextRunAt: nextRunAt?.toISOString() ?? null };
}

export async function runScheduledSync(): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) return log.info("scheduled sync skipped: no athlete connected", { event: "scheduler.skipped" });

  const token = await getStoredToken(userId);
  if (!token) return log.info("scheduled sync skipped: Strava not connected", { event: "scheduler.skipped" });
  if (token.reauth_required_at) return log.warn("scheduled sync skipped: Strava needs reconnecting", { event: "scheduler.skipped" });
  if (isSyncRunning("strava", userId)) return log.info("scheduled sync skipped: a Strava sync is already running", { event: "scheduler.skipped" });

  try {
    await syncActivities(userId, { trigger: "scheduled" });
  } catch (err) {
    // trackSyncRun has logged and recorded it; still run the Garmin step,
    // which doesn't depend on Strava having worked.
    if (err instanceof SyncInProgressError) return;
  }
  await afterStravaSync(userId, "scheduled");
}

function scheduleNext(delayMs: number) {
  nextRunAt = new Date(Date.now() + delayMs);
  timer = setTimeout(() => {
    runScheduledSync()
      .catch((err: unknown) => log.error("scheduled sync crashed", { event: "scheduler.crashed", err }))
      .finally(() => scheduleNext(scheduleIntervalMinutes() * 60 * 1000));
  }, delayMs);
  timer.unref();
}

export function startScheduler(): void {
  const minutes = scheduleIntervalMinutes();
  if (minutes === 0) {
    log.info("scheduled sync disabled (SYNC_INTERVAL_MINUTES=0)", { event: "scheduler.disabled" });
    return;
  }
  scheduleNext(FIRST_RUN_DELAY_MS);
  log.info("scheduled sync enabled", { event: "scheduler.enabled", intervalMinutes: minutes, firstRunAt: nextRunAt?.toISOString() });
}

export function stopScheduler(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  nextRunAt = null;
}
