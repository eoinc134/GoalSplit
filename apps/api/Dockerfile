# API service. Build context must be the repo root (not apps/api/) — this is
# an npm-workspaces monorepo, so `npm ci` needs the root package.json,
# package-lock.json and every workspace's manifest.
#
# node:22-slim, not 20 — better-sqlite3@13.0.3 requires Node >=22, and its
# prebuilt binary is built against Node 22's ABI (under Node 20 it segfaults
# on require). The deployed API never opens SQLite — Garmin data is imported
# from a home machine (scripts/home-garmin-sync.ps1) — but the dependency is
# still installed with the workspace.
FROM node:22-slim

# build-essential: guaranteed fallback for compiling better-sqlite3 if a
# future platform/Node combo lacks a matching prebuilt binary.
RUN apt-get update && apt-get install -y --no-install-recommends build-essential \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# .dockerignore (repo root) excludes node_modules and .env* — a local
# node_modules would carry Windows-compiled native addons into this Linux
# image, and .env files must never be baked into an image layer.
COPY . .
# --ignore-scripts: skip lifecycle scripts from npm dependencies.
# better-sqlite3 has no install script of its own, and npm's implicit
# node-gyp rebuild still runs for it, so nothing is lost.
# node_modules/.bin, not `npx` — turbo is a pinned devDependency; `npx` could
# fetch an unpinned version on demand if it were ever missing.
RUN npm ci --ignore-scripts && node_modules/.bin/turbo build --filter=@goalsplit/api

# The API only reads its own files and talks to Postgres — nothing writes to
# the container filesystem now that Garmin sync (and its Railway Volume) has
# moved off Railway — so it runs as the image's unprivileged `node` user.
USER node

ENV PORT=3001
EXPOSE 3001
CMD ["node", "apps/api/dist/index.js"]
