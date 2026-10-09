# GoalSplit

A sports data science project built on my own Strava training data and Garmin wellness
data — syncing activities, exporting training logs for LLM-assisted coaching, and
computing training load (ACWR), performance trends, and recovery signals (resting HR,
HRV, sleep, readiness).

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 15 (App Router, TypeScript, Tailwind CSS) |
| Backend | Express 5 (TypeScript) |
| Database | PostgreSQL (via `postgres.js`) |
| Shared types | TypeScript package (`@goalsplit/types`) |
| Monorepo | npm workspaces + Turborepo |

## Project structure

```
apps/
  web/         → Next.js frontend  (port 3000)
  api/         → Express REST API  (port 3001)
  mcp-trainer/ → MCP server exposing training data to Claude
packages/
  types/ → shared TypeScript types
```

## Getting started

**1. Install dependencies** (from the repo root):

```sh
npm install
```

**2. Configure environment variables:**

```sh
# Docker Compose variables (root)
cp .env.example .env

# API variables
cp apps/api/.env.example apps/api/.env
```

Fill in your Strava credentials in `apps/api/.env` (see [Strava integration](#strava-integration)
below). All other values are pre-filled for the local Docker setup.

**3. Start the database:**

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```sh
docker compose up -d
```

This starts PostgreSQL on **port 5433** (5432 is left free for any locally installed PostgreSQL). The schema is created automatically when the API first starts.

**4. Start all apps:**

```sh
npm run dev
```

| App | URL |
|---|---|
| Dashboard | http://localhost:3000 |
| API | http://localhost:3001/api |
| Health check | http://localhost:3001/health |

**Optional:** [Garmin health data](#garmin-health-data) (resting HR, sleep, readiness)
needs a separate, optional setup step — skip it for now if you just want Strava running.

## Strava integration

1. Go to [strava.com/settings/api](https://www.strava.com/settings/api) and create an app
2. Set the **Authorization Callback Domain** to `localhost`
3. Copy your **Client ID** and **Client Secret** into `apps/api/.env`:

```env
STRAVA_CLIENT_ID=your_client_id
STRAVA_CLIENT_SECRET=your_client_secret
STRAVA_REDIRECT_URI=http://localhost:3001/api/auth/strava/callback
```

4. Click **Connect Strava** on the dashboard and authorise the app
5. Hit **Sync Activities** to import your runs

### API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/auth/strava` | Redirect to Strava OAuth |
| `GET` | `/api/auth/strava/callback` | OAuth callback (handled automatically) |
| `GET` | `/api/auth/status` | Connection status + athlete info |
| `DELETE` | `/api/auth/strava` | Disconnect Strava |
| `GET` | `/api/activities` | List synced activities (`?type=Run&limit=50`) |
| `GET` | `/api/activities/export` | Recent training log for Claude (`?days=30&type=Run&format=markdown`) |
| `GET` | `/api/activities/:id` | Single activity detail: flattened row + decoded route + formatted notes |
| `POST` | `/api/activities/sync` | Sync latest activities from Strava |
| `POST` | `/api/activities/sync?full=true` | Backfill: walk full Strava history, fill in missing detail/streams dumps |
| `GET` | `/api/dashboard/stats` | Aggregated dashboard stats |
| `GET` | `/api/training/load` | ACWR + 28-day daily training-load series |
| `GET` | `/api/training/trends` | Weekly volume-by-type + Run pace (`?weeks=1-52`, default 12) |
| `GET` | `/api/training/hr-zones` | Time-in-HR-zone breakdown (`?days=7-180`, default 28) |
| `GET` | `/api/training/hr-drift` | Aerobic decoupling for recent qualifying runs (`?days=7-365&limit=1-50`, defaults 90/30) |
| `GET` | `/api/prs` | Merged personal records (Strava-derived + manual) |
| `POST` | `/api/prs` | Add a manual personal record |
| `DELETE` | `/api/prs/:id` | Remove a manual personal record |
| `POST` | `/api/garmin/sync` | Starts a Garmin sync in the background and returns `202` immediately (`?days=1-365`, default 7) — a cold login + backfill can run for several minutes, well past a typical edge-proxy timeout, so this never blocks on garmy finishing. Poll the status endpoint below instead of awaiting this. Legacy manual fallback in production — see [Home-based Garmin sync](#home-based-garmin-sync) for why this generally fails from Railway now. |
| `GET` | `/api/garmin/sync/status` | Current/last sync job status: `idle \| running \| done \| error`, plus the result or error once finished |
| `GET` | `/api/garmin/days` | Synced daily Garmin wellness data (`?days=7-365`, default 90) |

## Training data → Claude

Every synced activity gets raw payloads dumped into an append-only `activity_dumps` table
(see `apps/api/src/db/index.ts`): the cheap `list` payload from every sync, and two richer
one-time payloads fetched once per activity and cached forever — `detail` (splits, best
efforts, relative effort, your run notes) and `streams` (full time-series: heartrate, pace,
altitude, cadence, watts, grade, GPS — at native resolution, whatever Strava has for that
activity). The **Backfill History** button (next to Sync) walks your full Strava history to
fill in `detail`/`streams` dumps for activities synced before they existed — click it again
after the 15-minute Strava rate limit resets if it didn't finish in one pass.

`streams` is deliberately excluded from the training-export markdown/JSON below (see
`fetchDumpsForActivities` in `apps/api/src/routes/activities.ts`) — it powers the
HR-zone/decoupling analytics described further down instead.

The training log itself is available directly via
`GET /api/activities/export?days=30&format=markdown` (or `format=json`) — no UI for it,
consumed by the MCP server below.

### Live access via MCP

`apps/mcp-trainer` is a small [MCP](https://modelcontextprotocol.io) server that exposes
a `get_recent_training_data` tool, so a Claude Desktop "personal trainer" project can pull
your recent training data on demand instead of you copy-pasting it. It's a thin wrapper
around the export endpoint above — the API must be running.

Build it once (`npm run build --workspace=@goalsplit/mcp-trainer`), then add it to your
Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "goalsplit-trainer": {
      "command": "node",
      "args": ["C:\\ProjectFiles\\GoalSplit\\apps\\mcp-trainer\\dist\\index.js"],
      "env": {
        "GOALSPLIT_API_URL": "http://localhost:3001/api"
      }
    }
  }
}
```

Restart Claude Desktop and it'll have a `get_recent_training_data` tool it can call with
an optional `days` and `type` filter. For iterating on the server itself, swap the
`command`/`args` for `npx` / `["tsx", ".../apps/mcp-trainer/src/index.ts"]` to run from
source without a build step.

## Training load & performance trends

The **Training** page (`/training`) computes training load and volume/pace trends
straight from data that's already synced — no separate ingestion step, no backfill wait.

- **Training load (ACWR)** — acute:chronic workload ratio built from Strava's own
  `suffer_score` (Relative Effort), already captured in every activity's `list` dump.
  Acute = trailing 7 days, chronic = trailing 28 days, both including rest days as
  explicit zero-load so the average isn't skewed. Bands: `<0.8` undertraining,
  `0.8–1.3` sweet spot, `1.3–1.5` caution, `≥1.5` high injury risk (Gabbett/Hulin).
  Needs at least 28 days of synced history before showing a reading, and surfaces a
  `coveragePct` warning when a lot of activities in the window have no `suffer_score`
  (e.g. HR-less indoor rides).
- **Performance trends** — weekly training volume by activity type, and weekly average
  Run pace, over a configurable window (`?weeks=`, default 12, max 52).

Both are computed on the fly (`apps/api/src/lib/training-load.ts`,
`apps/api/src/routes/training.ts`) from the `activities` table and `list` dumps — no
materialized table, no cron job; the dataset is one person's activity history.

## Personal records

The **Records** page (`/prs`) tracks your best time per distance, computed fresh from
Strava every time rather than trusted from a stored value.

- **Strava-derived** — every activity's `detail` dump carries a `best_efforts` array
  (Strava's own standard-distance bests: 5K, 10K, Half-Marathon, Marathon, etc.). Rather
  than trust Strava's own `pr_rank` flag on any single activity (which goes stale — dumps
  are cached forever, so an old activity's flag doesn't update when a later run beats it),
  this recomputes the true minimum `elapsed_time` per distance across *every* cached
  `detail` dump on each request — self-healing, no migration needed as new bests appear.
- **Manual entries** — fill two real gaps: a distance/race Strava has no concept of at
  all, and a run Strava's own GPS-distance matching missed entirely (e.g. a true 10K
  effort that recorded 9.9 km never gets a "10K" `best_efforts` entry from Strava, no
  matter how fast it was). A manual entry can optionally link to the synced activity it
  corrects, for provenance, and competes on time like any other candidate — the faster of
  the two wins per distance, and the losing side stays visible for comparison.

Computed in `apps/api/src/lib/personal-records.ts` / `apps/api/src/routes/prs.ts`, same
on-the-fly, no-materialized-table posture as training load above.

## HR-zone analytics & aerobic decoupling

Two more sections on the **Training** page, built on the `streams` dump (full
per-activity time-series) rather than the cheaper `list`/`detail` payloads above — so
both need the **Backfill History** button to have actually run against your activities;
until then they show a prompt instead of an empty chart.

- **Time in HR zone** — heart-rate zones default to an *estimate* from the highest heart
  rate you've ever recorded (not a lab-measured max), split into 5 standard %-of-max
  bands. Once [Garmin data](#garmin-health-data) has synced at least one resting HR, this
  upgrades automatically to a **Karvonen (heart-rate-reserve) model** — `targetHR =
  restingHR + %intensity × (maxHR − restingHR)` — which is more individualized since it
  accounts for resting HR, not just peak; the active model is reported as
  `zoneModel: "karvonen" | "percent-max"` and shown in the page copy. Time-in-zone itself
  is bucketed from each activity's `heartrate`/`time` streams over a configurable window
  (`?days=`, default 28).
- **Aerobic decoupling** — for Run activities ≥20 minutes, compares an efficiency factor
  (pace ÷ heart rate) between the first and second half of the run. Under ~10% drift is a
  commonly cited sign of good aerobic durability for that effort. Indoor runs with a
  heart-rate stream but no GPS-derived distance stream still get a value, via a
  time-prorated distance proxy (flagged in the response as `usedDistanceFallback`).

Computed in `apps/api/src/lib/hr-zones.ts` / the same `apps/api/src/routes/training.ts`.
Grade-adjusted pace, power curves, and real HR/power zones from Strava's `/athlete/zones`
(which would need a broader OAuth scope than this app requests) remain deferred.

## Garmin health data

Strava only ever sees heart rate *during a recorded activity* — it has no idea what your
HR is at 3am or sitting at a desk. The **Recovery** page (`/recovery`) adds exactly that:
resting HR, HRV, sleep, and Garmin's own Training Readiness score — a recovery-side
companion to the training-load (ACWR) story above. Load tells you how much stress you're
taking on; this tells you how well you're absorbing it.

**Why garmy, not a TS package:** the obvious TS option (`garmin-connect` on npm) was
checked and rejected — last published Jan 2024, several methods still TODO, and it simply
doesn't expose resting HR, HRV, Body Battery, or training readiness, which is the entire
point of this integration. [garmy](https://github.com/bes-dev/garmy) (Python, unofficial —
built on the same reverse-engineered Garmin Connect login flow as the long-running
`python-garminconnect`/GarminDB community tools) documents all of them, with a local
SQLite mirror and incremental, dedup-aware sync. The API shells out to a small wrapper
script (`apps/api/scripts/garmy_sync.py`), then reads the resulting SQLite file directly
with `better-sqlite3` and mirrors the rows into Postgres
(`apps/api/src/services/garmin-sync.service.ts`). That SQLite file is garmy's own
"never re-fetch" cache, playing the same role `activity_dumps` plays for Strava — the
Postgres `garmin_days` table is a derived, re-buildable copy, not a second source of truth.

**Why a wrapper script instead of garmy's own CLI (`garmy.localdb.cli`):** two real
problems, both found live in production. First, that CLI's `get_credentials()` always
prompts interactively (`input()`/`getpass.getpass()`) — there's no env-var auth anywhere
in the package, so a non-interactive background process just hangs on a prompt nothing
will ever answer. Second, and more consequential: `SyncManager.initialize()` always
performs a brand-new full OAuth/SSO login, even though garmy's own `AuthClient` supports
loading a previously-saved session from disk and refreshing an expired token without a
full re-login. A background service re-logging in from scratch on every single sync is
what tripped Garmin's SSO rate limiting (`429 Too Many Requests`) after a handful of test
syncs in a short window. The wrapper script uses garmy's own public API directly (no
changes to garmy itself) in the order cached session → token refresh → full login, and
only ever falls all the way through to a full login on the very first sync or after
extended inactivity. Tokens are cached in a `garmy-tokens/` directory next to the SQLite
db, so they live on the same persistent Volume and survive restarts/redeploys.

### Setup

```sh
pip install garmy[localdb]
```

Then fill in `apps/api/.env` (see `.env.example`):

```env
GARMIN_EMAIL=
GARMIN_PASSWORD=
GARMY_DB_PATH=./garmin-health.db
```

**MFA must be disabled on the Garmin account** — the sync CLI authenticates
non-interactively and has no documented MFA-code handling. Click **Sync Garmin** on the
Recovery page once this is set up.

### Honest caveats

- Unofficial/reverse-engineered — garmy is young (created mid-2025), could break without
  notice if Garmin changes their backend. No SLA, unlike Strava's public API.
- Needs the Garmin account's actual password in `.env`, not a scoped OAuth token like
  Strava — same secrets discipline as the Strava client secret, higher blast radius if
  leaked.
- This is the first non-Node runtime dependency in the repo — Python 3.8+ is now a local
  dev prerequisite, same tier as the existing Docker Desktop requirement.
- **Doesn't run from Railway at all** — Garmin blocks Railway's egress IP for its
  OAuth endpoints (confirmed in production, not assumed). The actual sync runs from a
  home machine on a schedule instead — see
  [Home-based Garmin sync](#home-based-garmin-sync).

## Route maps

Clicking an activity (on the Dashboard or the Activities page) opens `/runs/[id]`, a
detail view with that activity's own route on an OpenStreetMap view (Leaflet +
`react-leaflet`, no API key needed), using the low-resolution `summary_polyline` already
present in every activity's cheap `list` dump — **no streams backfill needed**, unlike
the HR-zone sections above. Decoding happens server-side (`apps/api/src/lib/polyline.ts`),
so the client never needs a polyline library either. The detail view also shows the
activity's core stats and a formatted notes block reusing the same
workout-type/effort/cadence/description/splits/best-efforts rendering built for the
Claude training-log export (`buildActivityNote` in `apps/api/src/lib/training-export.ts`).

There's no separate "all routes at once" overview — routes are viewed per activity only.

## Roadmap

Sports-data-science direction, next up:

- Grade-adjusted pace, power curves, and real HR/power zones from Strava's
  `/athlete/zones` (would need a broader OAuth scope than this app currently requests).
- A Claude-coaching layer on top of the training-export data (tracked separately).

## Deployment (Railway)

Create two services in Railway (both pointing to this repo) plus a **PostgreSQL** addon.

### API service

| Setting | Value |
|---|---|
| Build command | `npm ci && npx turbo build --filter=@goalsplit/api` |
| Start command | `node apps/api/dist/index.js` |

Environment variables:

```
DATABASE_URL          → set automatically by the Railway Postgres addon
STRAVA_CLIENT_ID      → your Strava app client ID
STRAVA_CLIENT_SECRET  → your Strava app secret
STRAVA_REDIRECT_URI   → https://<api-domain>.railway.app/api/auth/strava/callback
FRONTEND_URL          → https://<web-domain>.railway.app
```

### Home-based Garmin sync

Garmin sync does **not** run from Railway — this was tried first (a Dockerfile +
persistent Volume setup, same shape as every other service here) and abandoned after
confirming in production that Garmin's API rejects Railway's egress IP for *every*
`oauth-service` call, not just repeated login attempts: both the SSO login page and the
supposedly-lightweight OAuth1→OAuth2 token refresh came back `429 Too Many Requests`,
even hours apart and even with a session that had been bootstrapped from a trusted
network. That rules out anything retry/backoff/caching can fix from inside Railway's
network — the Garmin-talking half of the sync has to run somewhere Garmin doesn't block.

So it runs on a home machine instead, on a schedule, writing directly into Railway's
Postgres over its *public* connection string — the app on Railway only ever reads
`garmin_days`, it never talks to Garmin at all.

**Setup:**

1. `python -m pip install garmy[localdb]` on the home machine (same as local dev).
2. Copy `.env.home-sync.example` (repo root) to `.env.home-sync` and fill in:
   - `GARMIN_EMAIL` / `GARMIN_PASSWORD`
   - `DATABASE_URL` — Railway's Postgres service's **public** connection string (its
     "Connect" tab, a `*.proxy.rlwy.net` hostname), not the internal
     `postgres.railway.internal` one the deployed API service uses — that only resolves
     inside Railway's own network.
3. Run `scripts\home-garmin-sync.ps1` once manually to confirm it works (it runs
   `apps/api/scripts/garmy_sync.py` to talk to Garmin, writing a local SQLite file, then
   `node apps/api/dist/scripts/import-garmin-days.js` to read that file and upsert into
   Postgres — `npm run build --workspace=apps/api` first if `dist/` doesn't exist yet).
4. Point Windows Task Scheduler at it for a daily run: Action → `powershell.exe`,
   Argument → `-ExecutionPolicy Bypass -File "<repo-root>\scripts\home-garmin-sync.ps1"`,
   Trigger → Daily, at a time the machine is reliably on.

The cached login session (see "Why a wrapper script" above) means only the very first
run — or one after an extended gap — needs real credentials at all; every other run
reuses or refreshes the cached token, now that refresh doesn't have to survive Railway's
IP being blocked.

The Railway-side `POST /api/garmin/sync` route and the **Sync Garmin** button on
`/recovery` still exist but are a legacy manual fallback — they'll generally fail with
the same `429` the home-sync setup exists to route around, since they still run from
Railway's blocked IP.

### Web service

| Setting | Value |
|---|---|
| Build command | `npm ci && npx turbo build --filter=@goalsplit/web` |
| Start command | `npm run start --workspace=apps/web` |

Environment variables:

```
NEXT_PUBLIC_API_URL   → https://<api-domain>.railway.app/api
```

> **Note:** `NEXT_PUBLIC_API_URL` must include `https://` and is baked in at build time — redeploy the web service after changing it.

Also update the **Authorization Callback Domain** in your [Strava app settings](https://www.strava.com/settings/api) to `<api-domain>.railway.app`.

## Commands

```sh
npm run dev          # start all apps in development mode
npm run build        # production build (all apps)
npm run type-check   # TypeScript check (all apps)
npm run lint         # lint (all apps)
npm run test         # run tests (all apps)
docker compose up -d # start local database
docker compose down  # stop local database
```
