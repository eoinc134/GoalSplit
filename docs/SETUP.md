# Setup & operations

Running GoalSplit locally, deploying it, and keeping the data syncing.

## Stack

Next.js 15 frontend (`apps/web`, port 3000) · Express 5 API (`apps/api`, port 3001) ·
PostgreSQL · shared TypeScript types (`packages/types`) · MCP server for Claude
(`apps/mcp-trainer`). npm workspaces + Turborepo.

## Run locally

Requires Node.js and Docker Desktop (plus Python 3.11+ for `research/` only).

```sh
npm install
cp .env.example .env                  # Docker Compose variables
cp apps/api/.env.example apps/api/.env # add Strava credentials and the Garmin API key
cp apps/web/.env.example apps/web/.env.local
docker compose up -d                  # Postgres on port 5433; schema is created on API start
npm run dev                           # web on :3000, API on :3001
```

Other commands: `npm run build`, `npm run test`, `npm run type-check`, `npm run lint`.

## Strava

1. Create an app at [strava.com/settings/api](https://www.strava.com/settings/api), callback domain `localhost`.
2. Put `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` and
   `STRAVA_REDIRECT_URI=http://localhost:3000/api/auth/strava/callback` in `apps/api/.env`.
   The callback is the **web** app's route: it runs the sign-in flow (see [Security](#security)).
3. **Connect Strava** on the dashboard, then **Sync Activities**.
4. Click **Backfill History** on the Activities page to fetch per-second streams for
   older activities. Streams power every HR- and pace-based analysis. Strava allows
   100 requests per 15 minutes, so the backfill stops at ~80 % of that and resumes on
   the next click.

**After each run:** set the run type on Strava (*Race*, *Long Run* or *Workout*;
leave easy runs as default) and give workouts a descriptive name, then **Sync**.
Sync also re-reads the past 7 days, so edits made after syncing come through. Edits
to anything older need **Backfill History**.

Raw Strava payloads are kept in an append-only `activity_dumps` table, so nothing ever
needs re-fetching. Each activity's streams are summarised once into `activity_metrics`
(see [METHODS.md](METHODS.md#data-and-preprocessing)). The summary fills in lazily on
the first Training-page load after a backfill, and is rebuilt automatically when
`METRICS_VERSION` changes. Reconnecting Strava stores the athlete's profile sex, which
selects the TRIMP coefficients.

## Garmin

Garmin provides resting HR, sleep, stress and Body Battery (and HRV on watches that
record it). Its resting HR switches heart-rate zones to Karvonen. Data comes from
Garmin's official **Personal API** (free, launched October 2026), so it runs from the
API itself: no password, no home machine.

1. In Garmin Connect (web), open account settings → **Personal API Key** → **Create
   Key**, and choose an expiry (30 days to a year). The key is shown only once.
2. Set `GARMIN_API=<key>` in `apps/api/.env`, and in the API service's Railway variables.
3. **Sync** on the dashboard also refreshes Garmin. The first sync backfills everything
   since your first Strava activity, and later ones re-read the last week.
   `POST /api/garmin/sync?days=N` re-syncs the last N days on demand.

When the key expires, sync reports "Garmin rejected the API key": create a new one
and update `GARMIN_API`. Resting HR from days the watch was barely worn is discarded
(see [METHODS.md](METHODS.md#heart-rate-zones)).

## Claude via MCP

`apps/mcp-trainer` exposes a `get_recent_training_data` tool, so Claude Desktop can pull
the recent training log. Build it with `npm run build --workspace=@goalsplit/mcp-trainer`, then add:

```json
{
  "mcpServers": {
    "goalsplit-trainer": {
      "command": "node",
      "args": ["C:\\ProjectFiles\\GoalSplit\\apps\\mcp-trainer\\dist\\index.js"],
      "env": { "GOALSPLIT_API_URL": "http://localhost:3001/api", "GOALSPLIT_API_KEY": "" }
    }
  }
}
```

`GOALSPLIT_API_KEY` is only needed when the API it points at has `API_KEY` set. The
repo's `.mcp.json` reads it from your environment rather than storing it.

## Security

GoalSplit is single-athlete. The pieces:

- **Sign-in:** Strava OAuth, run by the web app. A random `state` value in a
  short-lived cookie guards against login CSRF. The API only accepts the athlete in
  `ALLOWED_STRAVA_ATHLETE_ID` (locally, if unset: the first athlete to connect). A
  successful sign-in sets a signed, HttpOnly, `SameSite=Lax` session cookie that lasts
  30 days. **Sign out** clears it. Strava stays connected.
- **Web app as the only door:** `apps/web/src/middleware.ts` requires the session for
  every page and `/api/*` call. The browser never talks to the API directly. It calls
  the web app's same-origin `/api/*` proxy, which adds the API key server-side.
- **API:** every `/api` route requires `API_KEY` (`x-api-key` or `Authorization: Bearer`).
  Only `/health` is open. The API sends no CORS headers, so browsers can't call it
  cross-origin at all.
- **Rate limits** (API, per 15 min): 600 requests overall, 10 syncs (Strava + Garmin),
  20 OAuth code exchanges.
- **Strava tokens** are encrypted at rest with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`).
  Plaintext rows from before encryption are encrypted at startup. Concurrent refreshes
  share one Strava call. If Strava revokes access, sync says so: sign out and sign in again.
- **Fail closed:** with `NODE_ENV=production` the API won't start without `API_KEY`,
  `TOKEN_ENCRYPTION_KEY` and `ALLOWED_STRAVA_ATHLETE_ID`. A production web build
  without `SESSION_SECRET` refuses every request.

Locally, leaving those variables empty runs everything open, with no sign-in.

## Deploy (Railway)

Two services from this repo, plus a Postgres add-on.

| Service | Build | Start | Env |
|---|---|---|---|
| API | `npm ci && npx turbo build --filter=@goalsplit/api` | `node apps/api/dist/index.js` | `NODE_ENV=production`, `DATABASE_URL`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REDIRECT_URI` (`https://<web>/api/auth/strava/callback`), `GARMIN_API`, `API_KEY`, `TOKEN_ENCRYPTION_KEY`, `ALLOWED_STRAVA_ATHLETE_ID` |
| Web | `npm ci && npx turbo build --filter=@goalsplit/web` | `npm run start --workspace=apps/web` | `API_URL` (`http://<api>.railway.internal:<PORT>/api`, or the API's public URL), `API_KEY` (same value as the API's), `SESSION_SECRET` |

Set the Strava app's callback domain to the **web** service's Railway domain. Only the web
app calls the API, so if `API_URL` uses Railway's private network, the API service needs
no public domain at all. Generate secrets with `openssl rand -hex 32`.

## API

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/training/load?days=28–365` | TRIMP, CTL/ATL/TSB, EWMA ACWR, weekly monotony/strain |
| `GET` | `/api/training/intensity?weeks=4–52` | Weekly 5- and 3-zone time, polarization index |
| `GET` | `/api/training/efficiency?days=28–730` | Per-run EF, rolling median, Z2 pace, temperature model |
| `GET` | `/api/training/long-runs?days=28–1095` | Long-run drift/fade/HR rise, durability bins |
| `GET` | `/api/training/hr-zones?days=7–180` | Time in HR zone |
| `GET` | `/api/training/hr-drift?days=7–365&limit=1–50` | Aerobic decoupling per run |
| `GET` | `/api/training/trends?weeks=1–52` | Weekly volume by type, raw run pace |
| `GET` | `/api/activities` · `/api/activities/:id` | Synced activities, single activity with route + notes |
| `POST` | `/api/activities/sync[?full=true]` | Sync new activities, or backfill history |
| `GET` | `/api/activities/export?days=&type=&format=markdown\|json` | Training log for Claude |
| `GET` / `POST` / `DELETE` | `/api/prs` | Personal records (Strava-derived + manual) |
| `GET` | `/api/garmin/days?days=7–365` | Daily Garmin wellness data |
| `POST` | `/api/garmin/sync[?days=N]` | Pull from Garmin's Personal API (full history on first sync) |
| `GET` | `/api/auth/strava` · `/api/auth/status` | Strava OAuth and connection status |
