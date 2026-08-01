# GoalSplit

A personal running dashboard for tracking goals, personal bests, training history, and Strava activities.

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

Fill in your Strava credentials in `apps/api/.env` (see [Strava integration](#strava-integration) below). All other values are pre-filled for the local Docker setup.

**3. Start the database:**

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```sh
docker compose up -d
```

This starts PostgreSQL on **port 5433** (5432 is left free for any locally installed PostgreSQL). The schema and seed data are created automatically when the API first starts.

**4. Start all apps:**

```sh
npm run dev
```

| App | URL |
|---|---|
| Dashboard | http://localhost:3000 |
| API | http://localhost:3001/api |
| Health check | http://localhost:3001/health |

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
| `POST` | `/api/activities/sync` | Sync latest activities from Strava |
| `POST` | `/api/activities/sync?full=true` | Backfill: walk full Strava history, fill in missing detail dumps |
| `GET` | `/api/goals` | List all goals |
| `POST` | `/api/goals` | Create a goal |
| `PATCH` | `/api/goals/:id` | Update a goal |
| `DELETE` | `/api/goals/:id` | Delete a goal |
| `GET` | `/api/pbs` | List personal bests |
| `PATCH` | `/api/pbs/:id` | Update a personal best |
| `GET` | `/api/dashboard/stats` | Aggregated dashboard stats |

## Training data → Claude

Every synced activity gets two raw payloads dumped into an append-only `activity_dumps`
table (see `apps/api/src/db/index.ts`): the cheap `list` payload from every sync, and a
richer one-time `detail` payload (splits, best efforts, relative effort, your run notes)
fetched once per activity and cached forever. The **Backfill History** button (next to
Sync) walks your full Strava history to fill in `detail` dumps for activities synced
before this existed — click it again after the 15-minute Strava rate limit resets if it
didn't finish in one pass.

### Manual export

The **Runs** page has an export control next to Sync: pick a window (7/30/90 days) and
either **Copy for Claude** (copies a markdown training log to your clipboard — paste it
into any Claude conversation) or **Download .md**. Same data is available directly via
`GET /api/activities/export?days=30&format=markdown`.

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
