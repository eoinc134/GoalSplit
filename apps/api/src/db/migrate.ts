import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { log } from "../lib/logger.js";

// Schema changes live in apps/api/migrations as numbered .sql files, applied
// by node-pg-migrate and recorded in the `pgmigrations` table. The API runs
// pending migrations on startup, before it listens; locally use
// `npm run migrate -w apps/api` (see docs/SETUP.md → Database migrations).
//
// - An advisory lock means two containers booting together (Railway starts
//   the new one before stopping the old) can't migrate at the same time —
//   the second waits, then finds nothing pending.
// - All pending migrations run in one transaction: a failure rolls the whole
//   batch back and the API refuses to start, rather than serving traffic on
//   a half-migrated schema.
// - --check-order refuses to run if a new file sorts before one already
//   applied (e.g. two branches both adding 0010_*), instead of applying out
//   of order.
//
// Runs node-pg-migrate's CLI in a child `node` process rather than calling
// its runner() in-process: the package is ESM-only, and under tsx (npm run
// dev) a require() of it comes back empty. The CLI is a plain ES-module
// entry point that behaves the same everywhere — and it's exactly what
// `npm run migrate` uses, so startup and local runs can't drift apart.

// Compiled to dist/db/migrate.js, run from src/db/migrate.ts under tsx and
// Vitest — both two levels below apps/api.
export const MIGRATIONS_DIR = path.resolve(__dirname, "../../migrations");
export const MIGRATIONS_TABLE = "pgmigrations";

// The package's exports map ("./bin/*" → "./bin/*.js") appends the extension.
const CLI = createRequire(__filename).resolve("node-pg-migrate/bin/node-pg-migrate");
const TIMEOUT_MS = 5 * 60 * 1000;

// The CLI prints "### MIGRATION 0008_drop_legacy_tables (UP) ###" per file.
export function appliedMigrationNames(output: string): string[] {
  return [...output.matchAll(/^### MIGRATION (\S+) \(UP\) ###$/gm)].map((m) => m[1]);
}

// "Migration 0010_x failed: relation "y" does not exist" — the CLI announces
// each migration on stdout and prints Postgres' error as "error: …" on
// stderr, followed by a dump of the error object that's no use in a log.
export function describeMigrationFailure(stdout: string, stderr: string): string {
  const names = [...stdout.matchAll(/^### MIGRATION (\S+) \(UP\) ###$/gm)].map((m) => m[1]);
  const cause = /^error: (.+)$/m.exec(stderr)?.[1] ?? /^(.*\S)\s*$/m.exec(stderr)?.[1] ?? "unknown error";
  return names.length > 0 ? `Migration ${names.at(-1)} failed: ${cause}` : `Migrations failed: ${cause}`;
}

export function runMigrations(databaseUrl = process.env.DATABASE_URL): Promise<string[]> {
  if (!databaseUrl) return Promise.reject(new Error("DATABASE_URL env var is not set"));

  const args = [
    CLI,
    "up",
    "--migrations-dir", MIGRATIONS_DIR,
    "--migrations-table", MIGRATIONS_TABLE,
    "--check-order",
    "--single-transaction",
  ];

  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      args,
      // Only what the CLI needs: no API secrets in the child's environment.
      { env: { PATH: process.env.PATH, DATABASE_URL: databaseUrl }, timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        log.debug("migration output", { event: "db.migration_output", stdout, stderr });
        if (err) {
          const reason = err.killed ? `Migrations timed out after ${TIMEOUT_MS / 1000} s` : describeMigrationFailure(stdout, stderr);
          // Single transaction: the whole batch rolled back.
          log.error("database migration failed — no migrations applied", { event: "db.migration_failed", reason });
          return reject(new Error(reason));
        }
        const applied = appliedMigrationNames(stdout);
        if (applied.length > 0) log.info("database migrations applied", { event: "db.migrations_applied", migrations: applied });
        else log.info("database schema up to date", { event: "db.migrations_applied" });
        resolve(applied);
      },
    );
  });
}
