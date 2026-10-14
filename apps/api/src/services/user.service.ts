import { sql } from "../db/index.js";

// Single-user app: the one connected Strava athlete is "the user" everywhere.
// Kept in one place so moving to real per-request auth is a one-file change.
export async function getCurrentUserId(): Promise<string | null> {
  const [user] = await sql<{ id: string }[]>`SELECT id FROM users LIMIT 1`;
  return user?.id ?? null;
}
