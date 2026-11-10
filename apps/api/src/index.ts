import { app } from "./app.js";
import { initSchema } from "./db/index.js";
import { assertSecurityConfig } from "./lib/security-config.js";
import { encryptLegacyTokens } from "./services/token.service.js";
import { warnAboutForeignUsers } from "./services/user.service.js";

const PORT = process.env.PORT ?? 3001;

async function start() {
  assertSecurityConfig();
  await initSchema();

  const encrypted = await encryptLegacyTokens();
  if (encrypted > 0) console.log(`[security] Encrypted ${encrypted} legacy plaintext Strava token row(s)`);
  await warnAboutForeignUsers();

  app.listen(PORT, () => {
    console.log(`GoalSplit API running on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start API:", err);
  process.exit(1);
});
