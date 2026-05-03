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
  web/   → Next.js frontend  (port 3000)
  api/   → Express REST API  (port 3001)
packages/
  types/ → shared TypeScript types
```

## Getting started

**1. Install dependencies** (from the repo root):

```sh
npm install
```

**2. Start the database:**

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```sh
docker compose up -d
```

This starts PostgreSQL on **port 5433** (5432 is left free for any locally installed PostgreSQL).
The schema is created automatically when the API first starts.

**3. Configure environment variables:**

```sh
cp apps/api/.env.example  apps/api/.env
cp apps/web/.env.example  apps/web/.env.local
```

Open `apps/api/.env` and fill in your Strava credentials (see below). The database URL is pre-filled for the Docker setup.

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
| `POST` | `/api/activities/sync` | Sync latest activities from Strava |
| `GET` | `/api/goals` | List goals |
| `GET` | `/api/pbs` | List personal bests |

## Deployment (Railway)

1. Push the repo to GitHub
2. Create a new Railway project and add a **PostgreSQL** addon
3. Deploy the `apps/api` service — Railway sets `DATABASE_URL` automatically
4. Deploy the `apps/web` service and set `NEXT_PUBLIC_API_URL` to the API's public URL
5. Set `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, and update `STRAVA_REDIRECT_URI` to the production callback URL in both Railway and your Strava app settings

## Other commands

```sh
npm run build        # production build (all apps)
npm run type-check   # TypeScript check (all apps)
npm run lint         # lint (all apps)
docker compose down  # stop the database
```
