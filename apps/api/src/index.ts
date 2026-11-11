import { app } from "./app.js";
import { runMigrations } from "./db/migrate.js";
import { log } from "./lib/logger.js";
import { assertSecurityConfig } from "./lib/security-config.js";
import { startScheduler } from "./services/scheduler.js";
import { markInterruptedRuns } from "./services/sync-runs.service.js";
import { encryptLegacyTokens } from "./services/token.service.js";
import { warnAboutForeignUsers } from "./services/user.service.js";

const PORT = process.env.PORT ?? 3001;

async function start() {
  assertSecurityConfig();
  await runMigrations();

  const encrypted = await encryptLegacyTokens();
  if (encrypted > 0) log.info("encrypted legacy plaintext Strava tokens", { count: encrypted });
  await warnAboutForeignUsers();
  // Any sync still 'running' was cut off by the restart that got us here.
  await markInterruptedRuns();

  app.listen(PORT, () => {
    log.info("GoalSplit API listening", { port: Number(PORT), env: process.env.NODE_ENV ?? "development" });
  });
  startScheduler();
}

start().catch((err: unknown) => {
  log.error("failed to start API", { err });
  process.exit(1);
});
