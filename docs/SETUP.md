# Setup & operations

Running GoalSplit locally, deploying it, and keeping the data syncing.

## Stack

Next.js 15 frontend (`apps/web`, port 3000) · Express 5 API (`apps/api`, port 3001) ·
PostgreSQL · shared TypeScript types (`packages/types`) · MCP server for Claude
(`apps/mcp-trainer`). npm workspaces + Turborepo.

## Run locally

Requires Node.js, Docker Desktop, and Python 3.8+ (Garmin sync only).

```sh
npm install
cp .env.example .env                  # Docker Compose variables
cp apps/api/.env.example apps/api/.env # add Strava (and optionally Garmin) credentials
docker compose up -d                  # Postgres on port 5433; schema is created on API start
npm run dev                           # web on :3000, API on :3001
```

Other commands: `npm run build`, `npm run test`, `npm run type-check`, `npm run lint`.

## Strava

1. Create an app at [strava.com/settings/api](https://www.strava.com/settings/api), callback domain `localhost`.
2. Put `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` and
   `STRAVA_REDIRECT_URI=http://localhost:3001/api/auth/strava/callback` in `apps/api/.env`.
3. **Connect Strava** on the dashboard, then **Sync Activities**.
4. Click **Backfill History** on the Activities page to fetch per-second streams for
   older activities. Streams power every HR- and pace-based analysis. Strava allows
   100 requests per 15 minutes, so the backfill stops at ~80 % of that and resumes on
   the next click.

Raw Strava payloads are kept in an append-only `activity_dumps` table, so nothing ever
needs re-fetching. Each activity's streams are summarised once into `activity_metrics`
(see [METHODS.md](METHODS.md#data-and-preprocessing)). The summary fills in lazily on
the first Training-page load after a backfill, and is rebuilt automatically when
`METRICS_VERSION` changes. Reconnecting Strava stores the athlete's profile sex, which
selects the TRIMP coefficients.

## Garmin

Garmin provides resting HR, HRV, sleep and readiness, and its resting HR turns on
Karvonen zones. It uses [garmy](https://github.com/bes-dev/garmy), an unofficial Python
client, through `apps/api/scripts/garmy_sync.py`. Garmin blocks Railway's IP, so the sync
runs from a home machine and writes straight into the production database.

1. `python -m pip install garmy[localdb]`
2. Copy `.env.home-sync.example` to `.env.home-sync` and fill in `GARMIN_EMAIL`,
   `GARMIN_PASSWORD` and `DATABASE_URL`. Use the Railway Postgres **public** connection
   string (`*.proxy.rlwy.net`).
3. `npm run build --workspace=apps/api`, then run `scripts\home-garmin-sync.ps1` once to check it works.
4. Schedule it daily in Windows Task Scheduler: `powershell.exe -ExecutionPolicy Bypass -File "<repo>\scripts\home-garmin-sync.ps1"`.

MFA must be off on the Garmin account. The login session is cached in `garmy-tokens/`,
so only the first run, or one after a long gap, does a full login.

## Claude via MCP

`apps/mcp-trainer` exposes a `get_recent_training_data` tool, so Claude Desktop can pull
the recent training log. Build it with `npm run build --workspace=@goalsplit/mcp-trainer`, then add:

```json
{
  "mcpServers": {
    "goalsplit-trainer": {
      "command": "node",
      "args": ["C:\\ProjectFiles\\GoalSplit\\apps\\mcp-trainer\\dist\\index.js"],
      "env": { "GOALSPLIT_API_URL": "http://localhost:3001/api" }
    }
  }
}
```

## Deploy (Railway)

Two services from this repo, plus a Postgres add-on.

| Service | Build | Start | Env |
|---|---|---|---|
| API | `npm ci && npx turbo build --filter=@goalsplit/api` | `node apps/api/dist/index.js` | `DATABASE_URL`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REDIRECT_URI` (`https://<api>/api/auth/strava/callback`), `FRONTEND_URL` |
| Web | `npm ci && npx turbo build --filter=@goalsplit/web` | `npm run start --workspace=apps/web` | `NEXT_PUBLIC_API_URL` (`https://<api>/api`, baked in at build — redeploy after changing) |

Set the Strava app's callback domain to the API's Railway domain.

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
| `POST` / `GET` | `/api/garmin/sync` · `/api/garmin/sync/status` | Legacy in-app Garmin sync (blocked from Railway; use home sync) |
| `GET` | `/api/auth/strava` · `/api/auth/status` | Strava OAuth and connection status |
