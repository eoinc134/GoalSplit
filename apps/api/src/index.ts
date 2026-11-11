// Must be first: Sentry instruments http/express as they load.
import { Sentry } from "./instrument.js";
import type { Server } from "node:http";
import { app } from "./app.js";
import { sql } from "./db/index.js";
import { runMigrations } from "./db/migrate.js";
import { startDraining } from "./lib/lifecycle.js";
import { log } from "./lib/logger.js";
import { runtime } from "./lib/runtime-info.js";
import { assertSecurityConfig } from "./lib/security-config.js";
import { startScheduler, stopScheduler } from "./services/scheduler.js";
import { interruptActiveRuns, markInterruptedRuns } from "./services/sync-runs.service.js";
import { encryptLegacyTokens } from "./services/token.service.js";
import { warnAboutForeignUsers } from "./services/user.service.js";

const PORT = process.env.PORT ?? 3001;
// In-flight requests get this long to finish after SIGTERM before the
// process exits anyway. Railway waits a few seconds before SIGKILL.
const SHUTDOWN_GRACE_MS = Number(process.env.SHUTDOWN_GRACE_MS ?? 8000);

let server: Server | null = null;
let shuttingDown = false;

async function start() {
  assertSecurityConfig();
  await runMigrations();

  const encrypted = await encryptLegacyTokens();
  if (encrypted > 0) log.info("encrypted legacy plaintext Strava tokens", { event: "security.tokens_encrypted", count: encrypted });
  await warnAboutForeignUsers();
  // Any sync still 'running' was cut off by the restart that got us here.
  await markInterruptedRuns();

  server = app.listen(PORT, () => {
    log.info("GoalSplit API listening", {
      event: "app.started",
      port: Number(PORT),
      ...runtime,
      node: process.version,
      sentry: Boolean(process.env.SENTRY_DSN),
    });
  });
  startScheduler();
}

// Railway sends SIGTERM on every redeploy (once the new deployment is
// healthy) and on restarts. Shut down so nothing is lost silently:
// 1. /health/ready answers 503 and no new connections are accepted;
// 2. in-flight requests get SHUTDOWN_GRACE_MS to finish;
// 3. syncs still running are recorded as interrupted (they resume next time);
// 4. buffered Sentry events are sent and the DB pool is closed.
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  const started = Date.now();
  log.info("shutting down", { event: "app.stopping", signal, graceMs: SHUTDOWN_GRACE_MS });

  startDraining();
  stopScheduler();

  const closed = new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
    server.closeIdleConnections();
  });
  const graceOver = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), SHUTDOWN_GRACE_MS).unref());
  const outcome = await Promise.race([closed.then(() => "drained" as const), graceOver]);
  if (outcome === "timeout") server?.closeAllConnections();

  try {
    await interruptActiveRuns(`API shut down (${signal}) while the sync was running`);
  } catch (err) {
    log.warn("could not record interrupted syncs", { event: "sync.record_failed", err });
  }

  log.info("shutdown complete", { event: "app.stopped", signal, outcome, durationMs: Date.now() - started });
  await Sentry.flush(2000).catch(() => undefined);
  await sql.end({ timeout: 3 }).catch(() => undefined);
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// A rejected promise nobody handled: a bug, but not a reason to take the API
// down mid-request — log it (which reports it to Sentry) and carry on.
process.on("unhandledRejection", (reason) => {
  log.error("unhandled promise rejection", {
    event: "app.unhandled_rejection",
    err: reason instanceof Error ? reason : new Error(String(reason)),
  });
});

// A synchronous throw nobody caught: process state is unknown, so record it
// and exit; Railway restarts the service.
process.on("uncaughtException", (err) => {
  log.error("uncaught exception — exiting", { event: "app.crashed", err });
  void Sentry.flush(2000).finally(() => process.exit(1));
});

start().catch(async (err: unknown) => {
  log.error("failed to start API", { event: "app.start_failed", err });
  await Sentry.flush(2000).catch(() => undefined);
  process.exit(1);
});
