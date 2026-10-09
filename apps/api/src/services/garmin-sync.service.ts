import { spawn } from "node:child_process";
import path from "node:path";
import Database from "better-sqlite3";
import { sql } from "../db/index.js";
import { validateGarminConfig, toGarminDayPoint, type GarminDayRow } from "../lib/garmin.js";
import type { GarminSyncResult, GarminSyncStatus } from "@goalsplit/types";

// Invoked via our own apps/api/scripts/garmy_sync.py, not garmy's own CLI
// (garmy.localdb.cli) — that CLI has two problems for unattended, server-side
// use: `cmd_sync` always prompts interactively for credentials (no env-var
// support anywhere in the package — confirmed by reading the published
// sdist), and `SyncManager.initialize()` always performs a brand-new full
// OAuth/SSO login, even though garmy's own `AuthClient` supports loading a
// cached session from disk and refreshing an expired token without a full
// re-login. A background service doing a full login on every sync is what
// tripped Garmin's SSO rate limiting (429) in production — our wrapper tries
// cached session, then refresh, then full login, in that order (see the
// script itself for details). It's resolved relative to this compiled file
// (not the process CWD) since the Dockerfile's CMD runs from the repo root.
const SYNC_SCRIPT = path.join(__dirname, "..", "..", "scripts", "garmy_sync.py");

// A cold login + multi-day backfill can run well past a minute, which is well
// past Railway's edge-proxy timeout — confirmed in production: the HTTP
// request got killed (499/502) at 5 minutes while the sync itself produced no
// rows at all, meaning it never actually finished. Running it as a
// fire-and-forget background job (see startGarminSync/getGarminSyncStatus
// below) decouples the sync's duration from the HTTP request entirely. This
// hard timeout then exists only to fail a truly hung run loudly instead of
// letting it consume the container forever.
const SYNC_TIMEOUT_MS = 10 * 60 * 1000;

let jobStatus: GarminSyncStatus = {
  state: "idle",
  startedAt: null,
  finishedAt: null,
  days: null,
  result: null,
  error: null,
};

export function getGarminSyncStatus(): GarminSyncStatus {
  return jobStatus;
}

// Starts the sync in the background and returns immediately — callers must
// not await the actual sync here (see syncGarminDays), only the kickoff.
// Throws synchronously if a sync is already running or Garmin isn't
// configured, so the route can surface that before returning 202.
export function startGarminSync(userId: string, days: number): void {
  if (jobStatus.state === "running") throw new Error("GARMIN_SYNC_ALREADY_RUNNING");
  if (!validateGarminConfig()) throw new Error("GARMIN_NOT_CONFIGURED");

  jobStatus = { state: "running", startedAt: new Date().toISOString(), finishedAt: null, days, result: null, error: null };

  syncGarminDays(userId, days).then(
    (result) => {
      jobStatus = { ...jobStatus, state: "done", finishedAt: new Date().toISOString(), result };
    },
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      jobStatus = { ...jobStatus, state: "error", finishedAt: new Date().toISOString(), error: message };
    },
  );
}

function runGarmySync(days: number, config: { email: string; password: string; dbPath: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    // Tokens live in a directory next to the SQLite db itself, so they're on
    // the same persistent Volume and survive restarts/redeploys just like
    // the db file does.
    const tokenDir = path.join(path.dirname(config.dbPath), "garmy-tokens");

    // Explicit minimal env, not `...process.env` — the previous version
    // leaked every other secret (DATABASE_URL, STRAVA_CLIENT_SECRET, ...)
    // into this child process for no reason. PATH is a fixed literal, not
    // inherited from the parent process — confirmed via `docker run --rm
    // node:22-slim sh -c 'echo $PATH'` to be these exact directories, all
    // standard root-owned system paths (apt-get installs python3 into
    // /usr/bin), not something that should ever vary at runtime.
    const PYTHON_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

    const child = spawn(
      "python3",
      [SYNC_SCRIPT, "--db-path", config.dbPath, "--token-dir", tokenDir, "--last-days", String(days)],
      { env: { PATH: PYTHON_PATH, GARMIN_EMAIL: config.email, GARMIN_PASSWORD: config.password } },
    );

    // Stream the script's own output live into Railway's logs as it
    // happens, rather than only after the process exits — the whole point
    // is to be able to see where a run is stuck instead of guessing blind.
    child.stdout.on("data", (chunk: Buffer) => console.log(`[garmy-sync] ${chunk.toString().trimEnd()}`));
    child.stderr.on("data", (chunk: Buffer) => console.error(`[garmy-sync] ${chunk.toString().trimEnd()}`));

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`timed out after ${SYNC_TIMEOUT_MS / 1000}s`));
    }, SYNC_TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`garmy-sync exited with code ${code}`));
    });
  });
}

// Reads garmy's local SQLite cache and upserts every row it finds into
// Postgres — no date filtering, since re-importing a day already in
// Postgres is a harmless no-op (ON CONFLICT DO UPDATE) and this needs to
// work whether the SQLite file was just updated by a fresh sync or has
// months of history sitting in it already. Exported standalone so a
// separate machine can run this against the SQLite file garmy_sync.py
// produced, independent of whether that same machine is the one running
// the actual Garmin-talking half (see apps/api/src/scripts/import-garmin-days.ts).
export async function importGarminDaysFromSqlite(dbPath: string, userId: string): Promise<GarminSyncResult> {
  const db = new Database(dbPath, { readonly: true });
  let rows: GarminDayRow[];
  try {
    rows = db
      .prepare(
        `SELECT metric_date, resting_heart_rate, max_heart_rate, min_heart_rate, average_heart_rate,
                avg_stress_level, max_stress_level, body_battery_high, body_battery_low,
                sleep_duration_hours, training_readiness_score, training_readiness_level,
                hrv_last_night_avg, hrv_status, total_steps
         FROM daily_health_metrics
         ORDER BY metric_date`,
      )
      .all() as GarminDayRow[];
  } finally {
    db.close();
  }

  for (const row of rows) {
    const point = toGarminDayPoint(row);
    await sql`
      INSERT INTO garmin_days (
        id, user_id, day, resting_heart_rate, max_heart_rate, min_heart_rate, average_heart_rate,
        avg_stress_level, max_stress_level, body_battery_high, body_battery_low,
        sleep_duration_hours, training_readiness_score, training_readiness_level,
        hrv_last_night_avg, hrv_status, total_steps
      ) VALUES (
        ${crypto.randomUUID()}, ${userId}, ${point.day}, ${point.restingHeartRate}, ${point.maxHeartRate},
        ${point.minHeartRate}, ${point.averageHeartRate}, ${point.avgStressLevel}, ${point.maxStressLevel},
        ${point.bodyBatteryHigh}, ${point.bodyBatteryLow}, ${point.sleepDurationHours},
        ${point.trainingReadinessScore}, ${point.trainingReadinessLevel}, ${point.hrvLastNightAvg},
        ${point.hrvStatus}, ${point.totalSteps}
      )
      ON CONFLICT (user_id, day) DO UPDATE SET
        resting_heart_rate       = EXCLUDED.resting_heart_rate,
        max_heart_rate            = EXCLUDED.max_heart_rate,
        min_heart_rate            = EXCLUDED.min_heart_rate,
        average_heart_rate        = EXCLUDED.average_heart_rate,
        avg_stress_level          = EXCLUDED.avg_stress_level,
        max_stress_level          = EXCLUDED.max_stress_level,
        body_battery_high         = EXCLUDED.body_battery_high,
        body_battery_low          = EXCLUDED.body_battery_low,
        sleep_duration_hours       = EXCLUDED.sleep_duration_hours,
        training_readiness_score  = EXCLUDED.training_readiness_score,
        training_readiness_level  = EXCLUDED.training_readiness_level,
        hrv_last_night_avg        = EXCLUDED.hrv_last_night_avg,
        hrv_status                = EXCLUDED.hrv_status,
        total_steps               = EXCLUDED.total_steps,
        synced_at                 = NOW()
    `;
  }

  return { synced: rows.length };
}

// garmy handles Garmin's own (reverse-engineered) auth, incremental sync, and
// conflict resolution into its own SQLite file — this never talks to Garmin's
// API directly. We only read the result back out.
export async function syncGarminDays(userId: string, days: number): Promise<GarminSyncResult> {
  const config = validateGarminConfig();
  if (!config) throw new Error("GARMIN_NOT_CONFIGURED");

  try {
    await runGarmySync(days, config);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`GARMIN_SYNC_FAILED: ${message}`);
  }

  return importGarminDaysFromSqlite(config.dbPath, userId);
}
