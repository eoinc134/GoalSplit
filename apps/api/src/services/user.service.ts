import { sql } from "../db/index.js";
import { log } from "../lib/logger.js";

// Single-user app: the one allowed Strava athlete is "the user" everywhere.
// Kept in one place so moving to real per-request auth is a one-file change.
//
// ALLOWED_STRAVA_ATHLETE_ID pins who that is (required in production). Without
// it (local dev) the first athlete to connect claims the app, and nobody else
// can connect afterwards.

function allowedAthleteId(): number | null {
  const raw = process.env.ALLOWED_STRAVA_ATHLETE_ID;
  if (!raw) return null;
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("ALLOWED_STRAVA_ATHLETE_ID must be a numeric Strava athlete id");
  }
  return id;
}

export async function getCurrentUserId(): Promise<string | null> {
  const allowed = allowedAthleteId();
  const [user] = allowed === null
    ? await sql<{ id: string }[]>`SELECT id FROM users ORDER BY created_at, id LIMIT 1`
    : await sql<{ id: string }[]>`SELECT id FROM users WHERE strava_athlete_id = ${allowed}`;
  return user?.id ?? null;
}

export async function isAthleteAllowed(athleteId: number): Promise<boolean> {
  const allowed = allowedAthleteId();
  if (allowed !== null) return athleteId === allowed;

  const [owner] = await sql<{ strava_athlete_id: string }[]>`
    SELECT strava_athlete_id FROM users ORDER BY created_at, id LIMIT 1
  `;
  return !owner || Number(owner.strava_athlete_id) === athleteId;
}

// Logs (never deletes) users other than the allowed athlete — e.g. someone who
// connected while the OAuth callback was still open to anyone. Their rows are
// invisible to the app; remove them by hand if they exist.
export async function warnAboutForeignUsers(): Promise<void> {
  const allowed = allowedAthleteId();
  if (allowed === null) return;
  const [{ count }] = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count FROM users WHERE strava_athlete_id <> ${allowed}
  `;
  if (Number(count) > 0) {
    log.warn("user rows from a Strava athlete other than ALLOWED_STRAVA_ATHLETE_ID are being ignored", {
      count: Number(count),
      inspect: "SELECT id, strava_athlete_id, firstname FROM users;",
    });
  }
}
