import { sql } from "../db/index.js";
import { refreshToken as stravaRefresh, StravaAuthError } from "../lib/strava-client.js";
import { decryptToken, encryptToken, isEncrypted } from "../lib/token-crypto.js";

interface StoredToken {
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

// Thrown when Strava no longer accepts our refresh token (the athlete revoked
// access, or it was invalidated). Only reconnecting through OAuth fixes it.
export const STRAVA_REAUTH_REQUIRED = "STRAVA_REAUTH_REQUIRED";

export async function getStoredToken(userId: string): Promise<StoredToken | null> {
  const [row] = await sql<StoredToken[]>`
    SELECT user_id, access_token, refresh_token, expires_at
    FROM strava_tokens
    WHERE user_id = ${userId}
  `;
  if (!row) return null;
  return {
    ...row,
    access_token: decryptToken(row.access_token),
    refresh_token: decryptToken(row.refresh_token),
    expires_at: Number(row.expires_at),
  };
}

export async function saveToken(
  userId: string,
  token: { access_token: string; refresh_token: string; expires_at: number },
): Promise<void> {
  const access = encryptToken(token.access_token);
  const refresh = encryptToken(token.refresh_token);
  await sql`
    INSERT INTO strava_tokens (user_id, access_token, refresh_token, expires_at, updated_at)
    VALUES (${userId}, ${access}, ${refresh}, ${token.expires_at}, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      access_token  = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      expires_at    = EXCLUDED.expires_at,
      updated_at    = NOW()
  `;
}

// One in-flight refresh per user. Strava rotates the refresh token on use, so
// two concurrent refreshes (e.g. Sync clicked while a backfill runs) could
// leave the second holding a token Strava has already superseded.
const inflightRefresh = new Map<string, Promise<string>>();

async function refreshAndSave(token: StoredToken): Promise<string> {
  try {
    const refreshed = await stravaRefresh(token.refresh_token);
    await saveToken(token.user_id, refreshed);
    return refreshed.access_token;
  } catch (err) {
    if (err instanceof StravaAuthError) {
      console.error(`Strava refresh rejected for user ${token.user_id}: ${err.message}`);
      throw new Error(STRAVA_REAUTH_REQUIRED);
    }
    throw err;
  }
}

// Returns a valid access token, refreshing it if it expires within 5 minutes.
export async function getValidAccessToken(userId: string): Promise<string | null> {
  const token = await getStoredToken(userId);
  if (!token) return null;

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (token.expires_at - nowSeconds >= 300) return token.access_token;

  let pending = inflightRefresh.get(userId);
  if (!pending) {
    pending = refreshAndSave(token).finally(() => inflightRefresh.delete(userId));
    inflightRefresh.set(userId, pending);
  }
  return pending;
}

// Encrypts any token rows written before TOKEN_ENCRYPTION_KEY was set. Runs at
// startup; a no-op once everything is encrypted or when no key is configured.
export async function encryptLegacyTokens(): Promise<number> {
  if (!process.env.TOKEN_ENCRYPTION_KEY) return 0;

  const rows = await sql<StoredToken[]>`
    SELECT user_id, access_token, refresh_token, expires_at FROM strava_tokens
  `;
  const legacy = rows.filter((r) => !isEncrypted(r.access_token) || !isEncrypted(r.refresh_token));
  for (const row of legacy) {
    await sql`
      UPDATE strava_tokens SET
        access_token  = ${encryptToken(decryptToken(row.access_token))},
        refresh_token = ${encryptToken(decryptToken(row.refresh_token))}
      WHERE user_id = ${row.user_id}
    `;
  }
  return legacy.length;
}
