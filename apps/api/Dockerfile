# API service, including Python + garmy for Garmin sync. Build context must be
# the repo root (not apps/api/) — this is an npm-workspaces monorepo, so `npm
# ci` needs the root package.json/package-lock.json and every workspace's
# manifest, not just this one.
#
# Replaces an earlier Nixpacks-custom-phase approach that failed twice in a
# row on real Railway deploys in ways I couldn't debug blind (`garmy-sync`
# not on PATH at runtime, then `python3` itself not on PATH at runtime even
# though the build-time `pip install` succeeded) — Nixpacks' build-phase vs.
# final-runtime-image PATH handling for a custom additive phase wasn't
# something I had ground truth on, and guessing a third time risked a third
# failed deploy. A plain Dockerfile is standard, inspectable Docker semantics
# instead of third-party-buildpack internals.
FROM node:20-slim

# python3-pip's system install is "externally managed" on Debian 12+ (PEP 668)
# and refuses a bare `pip install` outside a venv — --break-system-packages is
# the correct override here, not a workaround: this container is dedicated to
# this one app, there's no other system Python usage to conflict with.
#
# build-essential (gcc/g++/make): better-sqlite3 is a native Node addon. It
# ships prebuilt binaries for common platform/Node-version combos and usually
# doesn't need to compile at all on Linux+Node20 — but "usually" isn't good
# enough here (hit exactly this gap locally: no prebuilt for a newer Node, and
# no VS Build Tools to fall back to node-gyp compiling from source). Installed
# as a guaranteed fallback so `npm ci` below can always compile it if needed.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip build-essential \
  && rm -rf /var/lib/apt/lists/* \
  && pip3 install --no-cache-dir --break-system-packages garmy[localdb]

WORKDIR /app

# .dockerignore (repo root) excludes node_modules — critical, not just for
# image size: a locally-built node_modules would carry Windows-compiled
# native addons (better-sqlite3) into this Linux image. `npm ci` below does a
# fresh, correctly-targeted install instead.
COPY . .
RUN npm ci
RUN npx turbo build --filter=@goalsplit/api

ENV PORT=3001
EXPOSE 3001
CMD ["node", "apps/api/dist/index.js"]
