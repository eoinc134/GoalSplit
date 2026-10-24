# API service. Build context must be the repo root (not apps/api/) — this is
# an npm-workspaces monorepo, so `npm ci` needs the root package.json,
# package-lock.json and every workspace's manifest.
FROM node:22-slim

WORKDIR /app

# .dockerignore (repo root) excludes node_modules, build output and every .env
# file — env files must never be baked into an image layer.
COPY . .
# --ignore-scripts: skip lifecycle scripts from npm dependencies; none of them
# need one. node_modules/.bin, not `npx` — turbo is a pinned devDependency;
# `npx` could fetch an unpinned version on demand if it were ever missing.
RUN npm ci --ignore-scripts && node_modules/.bin/turbo build --filter=@goalsplit/api

# The API only reads its own files and talks to Postgres and external APIs —
# nothing writes to the container filesystem — so it runs as the image's
# unprivileged `node` user.
USER node

ENV PORT=3001
EXPOSE 3001
CMD ["node", "apps/api/dist/index.js"]
