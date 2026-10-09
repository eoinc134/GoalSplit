// Standalone CLI: reads garmy's local SQLite cache and upserts every row
// into Postgres. Exists because Garmin's API started rejecting Railway's
// egress IP for *all* oauth-service calls (login AND token refresh), not
// just the login page — running garmy_sync.py from Railway can't work
// around that, so the Garmin-talking half now runs on a home machine
// instead, on its own schedule, writing to a local SQLite file. This script
// is the second half: point it at that local file and Railway's *public*
// Postgres connection string (not the internal one Railway's own API
// service uses) to get the data into the same database the deployed app
// reads from.
//
// Usage (DATABASE_URL must be Railway's public proxy URL, e.g.
// postgresql://postgres:...@xxxxx.proxy.rlwy.net:PORT/railway — the
// internal postgres.railway.internal hostname only resolves inside
// Railway's own network):
//   DATABASE_URL=postgresql://... node dist/scripts/import-garmin-days.js --db-path <path>

import { sql, initSchema } from "../db/index.js";
import { importGarminDaysFromSqlite } from "../services/garmin-sync.service.js";

async function main(): Promise<number> {
  const dbPathArgIndex = process.argv.indexOf("--db-path");
  const dbPath = dbPathArgIndex !== -1 ? process.argv[dbPathArgIndex + 1] : undefined;
  if (!dbPath) {
    console.error("Error: --db-path is required");
    return 1;
  }

  // This script runs independently of the Railway API process (that's the
  // whole point — a home machine, on its own schedule), so it can't assume
  // Railway has already redeployed with the latest schema. Idempotent, same
  // as every call site that runs it.
  await initSchema();

  // Same single-user-anchor convention as every other route in this app.
  const [user] = await sql<{ id: string }[]>`SELECT id FROM users LIMIT 1`;
  if (!user) {
    console.error("Error: no user found — sync Strava at least once first");
    return 1;
  }

  const result = await importGarminDaysFromSqlite(dbPath, user.id);
  console.log(`Imported ${result.synced} day(s) into Postgres.`);
  return 0;
}

main()
  .then((code) => {
    // postgres.js keeps the connection pool open otherwise, which would
    // leave this process hanging instead of exiting after a scheduled run.
    void sql.end().then(() => process.exit(code));
  })
  .catch((err: unknown) => {
    console.error("Error:", err instanceof Error ? err.message : String(err));
    void sql.end().then(() => process.exit(1));
  });
