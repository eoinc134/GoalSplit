import { sql } from "../db/index.js";
import { refreshToken as stravaRefresh } from "../lib/strava-client.js";

interface StoredToken {
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export async function getStoredToken(): Promise<StoredToken | null> {
  const [row] = await sql<StoredToken[]>`
    SELECT user_id, access_token, refresh_token, expires_at
    FROM strava_tokens
    LIMIT 1
  `;
  return row ?? null;
}

export async function saveToken(
  userId: string,
  token: { access_token: string; refresh_token: string; expires_at: number },
): Promise<void> {
  await sql`
    INSERT INTO strava_tokens (user_id, access_token, refresh_token, expires_at, updated_at)
    VALUES (${userId}, ${token.access_token}, ${token.refresh_token}, ${token.expires_at}, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      access_token  = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      expires_at    = EXCLUDED.expires_at,
      updated_at    = NOW()
  `;
}

// Returns a valid access token, refreshing it if it expires within 5 minutes.
export async function getValidAccessToken(): Promise<string | null> {
  const token = await getStoredToken();
  if (!token) return null;

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (token.expires_at - nowSeconds < 300) {
    const refreshed = await stravaRefresh(token.refresh_token);
    await saveToken(token.user_id, refreshed);
    return refreshed.access_token;
  }

  return token.access_token;
}
