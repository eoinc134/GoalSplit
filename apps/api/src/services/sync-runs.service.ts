import type postgres from "postgres";
import { sql } from "../db/index.js";
import { log } from "../lib/logger.js";

export type SyncSource = "strava" | "garmin";
export type SyncTrigger = "manual" | "scheduled" | "after_strava";
export type SyncRunStatus = "running" | "ok" | "partial" | "failed" | "interrupted";

// Thrown when a sync for the same source is already running. One at a time
// per source: two concurrent Strava syncs would fetch the same detail and
// streams twice (duplicate dumps, double quota), and Garmin backfills would
// race on the resume cursor.
//
// The lock is in-process, which is enough while the API runs as a single
// Railway instance; a second replica would need a Postgres advisory lock.
export class SyncInProgressError extends Error {
  constructor(source: SyncSource) {
    super(`A ${source} sync is already running`);
    this.name = "SyncInProgressError";
  }
}

const running = new Map<string, string>(); // `${source}:${userId}` → run id

export function isSyncRunning(source: SyncSource, userId: string): boolean {
  return running.has(`${source}:${userId}`);
}

export interface RunOutcome<T> {
  result: T;
  status: "ok" | "partial";
  items: number;
  details?: Record<string, unknown>;
}

export interface RunContext {
  runId: string;
  // Persist progress mid-run (e.g. Garmin's backfill cursor), so a crash or
  // failure still leaves a record of how far the run got.
  saveProgress(details: Record<string, unknown>, items?: number): Promise<void>;
}

// Error text stored on the run and shown in the UI: our own error codes and
// messages only. Strava/Garmin response bodies never get into error messages
// (see strava-client.ts), so this is safe to surface.
function describe(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 500) : "Unknown error";
}

export async function trackSyncRun<T>(
  opts: { userId: string; source: SyncSource; mode: string; trigger: SyncTrigger },
  fn: (ctx: RunContext) => Promise<RunOutcome<T>>,
): Promise<T> {
  const key = `${opts.source}:${opts.userId}`;
  if (running.has(key)) throw new SyncInProgressError(opts.source);

  const runId = crypto.randomUUID();
  running.set(key, runId);
  const runLog = log.child({ runId, source: opts.source, mode: opts.mode, trigger: opts.trigger });
  const started = Date.now();
  let progress: Record<string, unknown> = {};

  try {
    await sql`
      INSERT INTO sync_runs (id, user_id, source, mode, trigger, status)
      VALUES (${runId}, ${opts.userId}, ${opts.source}, ${opts.mode}, ${opts.trigger}, 'running')
    `;
    runLog.info("sync started");

    const ctx: RunContext = {
      runId,
      async saveProgress(details, items) {
        progress = { ...progress, ...details };
        await sql`
          UPDATE sync_runs SET
            details = ${sql.json(progress as postgres.JSONValue)},
            items   = COALESCE(${items ?? null}, items)
          WHERE id = ${runId}
        `;
      },
    };

    let outcome: RunOutcome<T>;
    try {
      outcome = await fn(ctx);
    } catch (err) {
      const durationMs = Date.now() - started;
      await sql`
        UPDATE sync_runs SET status = 'failed', finished_at = NOW(), error = ${describe(err)}
        WHERE id = ${runId}
      `.catch((dbErr: unknown) => runLog.error("could not record failed sync", { err: dbErr }));
      runLog.error("sync failed", { durationMs, err });
      throw err;
    }

    const details = { ...progress, ...outcome.details };
    await sql`
      UPDATE sync_runs SET
        status = ${outcome.status}, finished_at = NOW(), items = ${outcome.items},
        details = ${sql.json(details as postgres.JSONValue)}
      WHERE id = ${runId}
    `;
    const fields = { durationMs: Date.now() - started, items: outcome.items, ...details };
    if (outcome.status === "partial") runLog.warn("sync finished partially", fields);
    else runLog.info("sync finished", fields);
    return outcome.result;
  } finally {
    running.delete(key);
  }
}

// Runs left 'running' by a process that died (deploy, crash, OOM) mid-sync.
export async function markInterruptedRuns(): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    UPDATE sync_runs SET status = 'interrupted', finished_at = NOW(),
      error = 'API restarted while the sync was running'
    WHERE status = 'running'
    RETURNING id
  `;
  if (rows.length > 0) log.warn("marked interrupted sync runs", { count: rows.length });
  return rows.length;
}

export interface SyncRunRow {
  id: string;
  source: SyncSource;
  mode: string;
  trigger: SyncTrigger;
  status: SyncRunStatus;
  started_at: string;
  finished_at: string | null;
  items: number;
  details: Record<string, unknown>;
  error: string | null;
}

export async function latestRuns(userId: string, source: SyncSource, limit = 10): Promise<SyncRunRow[]> {
  return sql<SyncRunRow[]>`
    SELECT id, source, mode, trigger, status, started_at, finished_at, items, details, error
    FROM sync_runs
    WHERE user_id = ${userId} AND source = ${source}
    ORDER BY started_at DESC
    LIMIT ${limit}
  `;
}
