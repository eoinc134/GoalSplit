import { spawn } from "node:child_process";
import Database from "better-sqlite3";
import { sql } from "../db/index.js";
import { validateGarminConfig, toGarminDayPoint, type GarminDayRow } from "../lib/garmin.js";
import type { GarminSyncResult, GarminSyncStatus } from "@goalsplit/types";

// Invoked as `python3 -m garmy.localdb.cli` rather than the pip-installed
// `garmy-sync` console script — the console script's wrapper lives in pip's
// bin directory, which isn't reliably on PATH in every environment (hit this
// exact failure on Railway: `spawn garmy-sync ENOENT`, even though garmy
// itself was correctly installed). `garmy.localdb.cli` has a `__main__` guard
// (`python -m <module> <args>` runs `main()` with sys.argv the normal way,
// identical to the console script) and only depends on `python3` itself being
// on PATH, which is a far safer assumption than a pip console-script's bin dir.
const PYTHON_MODULE = "garmy.localdb.cli";

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
    // garmy's CLI (v2.0.0) has NO env-var-based auth at all — `cmd_sync` in
    // localdb/cli.py unconditionally calls input()/getpass.getpass() for
    // credentials, and there's no GARMIN_EMAIL/GARMIN_PASSWORD support
    // anywhere in the package (confirmed by grepping the published sdist).
    // This is what caused the production hang: the process sat on a stdin
    // prompt nothing was ever going to answer. Feeding credentials via
    // stdin works because Python's getpass falls back to a plain stdin read
    // once it can't open /dev/tty (no controlling terminal on a spawned
    // child), which is exactly this case. --db-path must also be passed as
    // an explicit arg — the CLI never reads GARMY_DB_PATH either, so without
    // this it would've written to a default `health.db` in the container's
    // ephemeral CWD instead of the persistent Volume. It has to come BEFORE
    // the `sync` subcommand, not after — argparse defines --db-path on the
    // parent parser, not the `sync` subparser, and a parent-only option
    // can't appear after the subcommand token (confirmed in production:
    // `error: unrecognized arguments: --db-path ...` when it was placed
    // after `sync`).
    const child = spawn(
      "python3",
      ["-m", PYTHON_MODULE, "--db-path", config.dbPath, "sync", "--last-days", String(days), "--progress", "simple"],
      { env: process.env },
    );

    // Stream garmy's own output live into Railway's logs as it happens,
    // rather than only after the process exits — the whole point is to be
    // able to see where a run is stuck instead of guessing blind again.
    child.stdout.on("data", (chunk: Buffer) => console.log(`[garmy-sync] ${chunk.toString().trimEnd()}`));
    child.stderr.on("data", (chunk: Buffer) => console.error(`[garmy-sync] ${chunk.toString().trimEnd()}`));

    child.stdin.write(`${config.email}\n${config.password}\n`);
    child.stdin.end();

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

  const db = new Database(config.dbPath, { readonly: true });
  let rows: GarminDayRow[];
  try {
    rows = db
      .prepare(
        `SELECT metric_date, resting_heart_rate, max_heart_rate, min_heart_rate, average_heart_rate,
                avg_stress_level, max_stress_level, body_battery_high, body_battery_low,
                sleep_duration_hours, training_readiness_score, training_readiness_level,
                hrv_last_night_avg, hrv_status, total_steps
         FROM daily_health_metrics
         WHERE metric_date >= date('now', ?)
         ORDER BY metric_date`,
      )
      .all(`-${days} days`) as GarminDayRow[];
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
