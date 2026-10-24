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
      "env": { "GOALSPLIT_API_URL": "http://localhost:3001/api" }
    }
  }
}
```

## Deploy (Railway)

Two services from this repo, plus a Postgres add-on.

| Service | Build | Start | Env |
|---|---|---|---|
| API | `npm ci && npx turbo build --filter=@goalsplit/api` | `node apps/api/dist/index.js` | `DATABASE_URL`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REDIRECT_URI` (`https://<api>/api/auth/strava/callback`), `FRONTEND_URL`, `GARMIN_API` |
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
| `POST` | `/api/garmin/sync[?days=N]` | Pull from Garmin's Personal API (full history on first sync) |
| `GET` | `/api/auth/strava` · `/api/auth/status` | Strava OAuth and connection status |
