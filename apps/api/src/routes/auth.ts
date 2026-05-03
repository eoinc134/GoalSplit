import { Router } from "express";
import { sql } from "../db/index.js";
import { buildAuthUrl, exchangeCode } from "../lib/strava-client.js";
import { saveToken } from "../services/token.service.js";

export const authRouter = Router();

// Step 1: redirect user to Strava OAuth page
authRouter.get("/strava", (_req, res) => {
  res.redirect(buildAuthUrl());
});

// Step 2: Strava redirects back here with ?code=...
authRouter.get("/strava/callback", async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
  const { code, error } = req.query;

  if (error || !code || typeof code !== "string") {
    return res.redirect(`${frontendUrl}?strava=error&reason=${error ?? "no_code"}`);
  }

  try {
    const tokenData = await exchangeCode(code);
    const athlete = tokenData.athlete;

    // Upsert user row
    await sql`
      INSERT INTO users (id, strava_athlete_id, username, firstname, lastname, profile_url)
      VALUES (${crypto.randomUUID()}, ${athlete.id}, ${athlete.username ?? null},
              ${athlete.firstname}, ${athlete.lastname}, ${athlete.profile ?? null})
      ON CONFLICT (strava_athlete_id) DO UPDATE SET
        username    = EXCLUDED.username,
        firstname   = EXCLUDED.firstname,
        lastname    = EXCLUDED.lastname,
        profile_url = EXCLUDED.profile_url
    `;

    const [user] = await sql<{ id: string }[]>`
      SELECT id FROM users WHERE strava_athlete_id = ${athlete.id}
    `;

    await saveToken(user.id, {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: tokenData.expires_at,
    });

    return res.redirect(`${frontendUrl}?strava=connected`);
  } catch (err) {
    console.error("Strava auth error:", err);
    return res.redirect(`${frontendUrl}?strava=error&reason=token_exchange_failed`);
  }
});

// Connection status — used by the frontend to show athlete info / connect button
authRouter.get("/status", async (_req, res) => {
  const [row] = await sql<{
    id: string;
    username: string;
    firstname: string;
    lastname: string;
    profile_url: string;
    strava_athlete_id: number;
    expires_at: number;
    updated_at: string;
  }[]>`
    SELECT u.id, u.username, u.firstname, u.lastname, u.profile_url, u.strava_athlete_id,
           t.expires_at, t.updated_at
    FROM users u
    JOIN strava_tokens t ON t.user_id = u.id
    LIMIT 1
  `;

  if (!row) {
    return res.json({ data: { isConnected: false } });
  }

  return res.json({
    data: {
      isConnected: true,
      athlete: {
        id: row.id,
        stravaAthleteId: row.strava_athlete_id,
        username: row.username,
        firstname: row.firstname,
        lastname: row.lastname,
        profileUrl: row.profile_url,
      },
      tokenExpiresAt: row.expires_at,
      lastSyncedAt: row.updated_at,
    },
  });
});

// Disconnect — removes tokens and user data
authRouter.delete("/strava", async (_req, res) => {
  // CASCADE handles strava_tokens and activities
  await sql`DELETE FROM users`;
  return res.json({ data: { disconnected: true } });
});
