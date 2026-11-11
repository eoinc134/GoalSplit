import { readdirSync } from "node:fs";
import { Router } from "express";
import { sql } from "../db/index.js";
import { MIGRATIONS_DIR } from "../db/migrate.js";
import { isDraining } from "../lib/lifecycle.js";
import { runtime, uptimeSeconds } from "../lib/runtime-info.js";

// Public health endpoints (no API key — Railway's deploy check and the
// uptime monitor call them). They reveal nothing internal beyond version
// and pass/fail per check; detailed pipeline state stays behind the API key
// at /api/sync/status.
//
// GET /health/live   — the process is up and the event loop responsive.
//                      Touches nothing; use for "should this be restarted?"
// GET /health/ready  — this instance can serve requests: database reachable
//                      and every migration applied. 503 otherwise, and while
//                      shutting down. Use for Railway's deploy healthcheck so
//                      a deploy only goes live once it can reach Postgres.
//                      Deliberately ignores Strava/Garmin: their outages
//                      don't make the API unhealthy.
// GET /health        — kept as an alias of /live for existing configuration.

export const healthRouter = Router();

const DB_TIMEOUT_MS = 2000;
// Cheap, but public: cache so a flood of probes can't become a flood of queries.
const READY_CACHE_MS = 5000;

// The migration files shipped with this build. Read once: they can't change
// while the process runs.
const expectedMigrations = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => f.replace(/\.sql$/, ""));

interface Check {
  ok: boolean;
  latencyMs?: number;
  error?: string;
  pending?: number;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms).unref()),
  ]);
}

async function checkDatabase(): Promise<{ database: Check; migrations: Check }> {
  const started = Date.now();
  try {
    // pgmigrations = MIGRATIONS_TABLE in db/migrate.ts.
    const rows = await withTimeout(sql<{ name: string }[]>`SELECT name FROM pgmigrations`, DB_TIMEOUT_MS);
    const applied = new Set(rows.map((r) => r.name));
    const pending = expectedMigrations.filter((m) => !applied.has(m)).length;
    return {
      database: { ok: true, latencyMs: Date.now() - started },
      migrations: { ok: pending === 0, pending },
    };
  } catch (err) {
    // Generic on purpose: this response is public.
    const timedOut = err instanceof Error && err.message.startsWith("timed out");
    return {
      database: { ok: false, latencyMs: Date.now() - started, error: timedOut ? "timeout" : "unreachable" },
      migrations: { ok: false },
    };
  }
}

let cached: { at: number; status: number; body: unknown } | null = null;

export function resetHealthCacheForTests(): void {
  cached = null;
}

function base() {
  return { service: runtime.service, version: runtime.version, uptimeSeconds: uptimeSeconds() };
}

function live(_req: unknown, res: { json: (b: unknown) => void }) {
  res.json({ status: "ok", ...base() });
}

healthRouter.get("/health", live);
healthRouter.get("/health/live", live);

healthRouter.get("/health/ready", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (isDraining()) {
    return res.status(503).json({ status: "draining", ...base() });
  }
  if (cached && Date.now() - cached.at < READY_CACHE_MS) {
    return res.status(cached.status).json(cached.body);
  }

  const checks = await checkDatabase();
  const ok = checks.database.ok && checks.migrations.ok;
  const status = ok ? 200 : 503;
  const body = { status: ok ? "ok" : "unavailable", ...base(), checks };
  cached = { at: Date.now(), status, body };
  return res.status(status).json(body);
});
