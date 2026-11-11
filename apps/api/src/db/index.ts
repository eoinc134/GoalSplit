import postgres from "postgres";
import { log } from "../lib/logger.js";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL env var is not set");
}

export const sql = postgres(process.env.DATABASE_URL, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
  // postgres.js prints server NOTICEs as multi-line objects by default; keep
  // them at debug level. (Schema changes are migrations now — see migrate.ts.)
  onnotice: (notice) => log.debug("postgres notice", { event: "db.notice", message: notice.message, code: notice.code }),
});
