import { Router } from "express";
import { sql } from "../db/index.js";
import { buildAuthUrl, exchangeCode, StravaAuthError } from "../lib/strava-client.js";
import { authLimiter } from "../middleware/rate-limit.js";
import { log } from "../lib/logger.js";
import { saveToken } from "../services/token.service.js";
import { getCurrentUserId, isAthleteAllowed } from "../services/user.service.js";

// Strava OAuth, driven by the web app. The browser only ever talks to the web
// app: it generates the `state` value (kept in a cookie), sends the user to
// the URL built here, receives Strava's redirect on its own callback, checks
// `state`, and then posts the code to /exchange. Like every /api route these
// require the API key, so only the web server can call them.
export const authRouter = Router();

authRouter.get("/strava/authorize-url", (req, res) => {
  const { state } = req.query;
  if (typeof state !== "string" || state.length < 16) {
    return res.status(400).json({ error: "state is required", statusCode: 400 });
  }
  return res.json({ data: { url: buildAuthUrl(state) } });
});

authRouter.post("/strava/exchange", authLimiter, async (req, res) => {
  const { code, scope } = (req.body ?? {}) as { code?: unknown; scope?: unknown };
  if (typeof code !== "string" || code.length === 0) {
    return res.status(400).json({ error: "code is required", statusCode: 400 });
  }
  // Strava's consent screen lets the athlete untick permissions. Without
  // activity:read_all sign-in would "work" but every sync would fail, so
  // refuse up front (before spending the code). `scope` is what Strava put on
  // the callback URL; absent means an older web build — let it through.
  if (typeof scope === "string" && !scope.split(",").includes("activity:read_all")) {
    log.warn("strava sign-in refused: activity:read_all not granted", { event: "strava.signin_refused", scope });
    return res.status(403).json({ error: "insufficient_scope", statusCode: 403 });
  }

  let tokenData;
  try {
    tokenData = await exchangeCode(code);
  } catch (err) {
    log.error("strava code exchange failed", { event: "strava.exchange_failed", err });
    const statusCode = err instanceof StravaAuthError ? 400 : 502;
    return res.status(statusCode).json({ error: "token_exchange_failed", statusCode });
  }

  const athlete = tokenData.athlete;
  if (!(await isAthleteAllowed(athlete.id))) {
    log.warn("strava sign-in refused: not the allowed athlete", { event: "strava.signin_refused", athleteId: athlete.id });
    return res.status(403).json({ error: "athlete_not_allowed", statusCode: 403 });
  }

  await sql`
    INSERT INTO users (id, strava_athlete_id, username, firstname, lastname, profile_url, sex)
    VALUES (${crypto.randomUUID()}, ${athlete.id}, ${athlete.username ?? null},
            ${athlete.firstname}, ${athlete.lastname}, ${athlete.profile ?? null},
            ${athlete.sex === "M" || athlete.sex === "F" ? athlete.sex : null})
    ON CONFLICT (strava_athlete_id) DO UPDATE SET
      username    = EXCLUDED.username,
      firstname   = EXCLUDED.firstname,
      lastname    = EXCLUDED.lastname,
      profile_url = EXCLUDED.profile_url,
      sex         = EXCLUDED.sex
  `;

  const [user] = await sql<{ id: string }[]>`
    SELECT id FROM users WHERE strava_athlete_id = ${athlete.id}
  `;

  await saveToken(user.id, {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_at: tokenData.expires_at,
  });
  log.info("strava connected", { event: "strava.connected", athleteId: athlete.id });

  return res.json({ data: { athleteId: athlete.id } });
});

// Connection status — used by the frontend to show athlete info
authRouter.get("/status", async (_req, res) => {
  const userId = await getCurrentUserId();
  const [row] = userId === null ? [] : await sql<{
    id: string;
    username: string;
    firstname: string;
    lastname: string;
    profile_url: string;
    strava_athlete_id: number;
    expires_at: number;
    updated_at: string;
    reauth_required_at: string | null;
  }[]>`
    SELECT u.id, u.username, u.firstname, u.lastname, u.profile_url, u.strava_athlete_id,
           t.expires_at, t.updated_at, t.reauth_required_at
    FROM users u
    JOIN strava_tokens t ON t.user_id = u.id
    WHERE u.id = ${userId}
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
      needsReconnect: row.reauth_required_at !== null,
    },
  });
});

// Disconnect — removes the current user's tokens and data (CASCADE handles
// strava_tokens, activities and everything hanging off them).
authRouter.delete("/strava", async (_req, res) => {
  const userId = await getCurrentUserId();
  if (userId) await sql`DELETE FROM users WHERE id = ${userId}`;
  return res.json({ data: { disconnected: true } });
});
