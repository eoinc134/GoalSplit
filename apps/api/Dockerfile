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
#
# node:22-slim, not 20 — better-sqlite3@13.0.3 requires Node >=22 (its own
# package.json engines field) and its bundled prebuilt binary is built
# against Node 22's ABI. Running it under Node 20 doesn't fail cleanly: it
# segfaults (SIGSEGV, exit 139) the moment the native module is required —
# confirmed by actually running the built image, not just building it. This
# was a latent bug from when the Dockerfile was first written; nothing
# surfaced it earlier because the Garmin sync flow never got far enough in
# production to reach the line that requires better-sqlite3 before now.
FROM node:22-slim

# python3-pip's system install is "externally managed" on Debian 12+ (PEP 668)
# and refuses a bare `pip install` outside a venv — --break-system-packages is
# the correct override here, not a workaround: this container is dedicated to
# this one app, there's no other system Python usage to conflict with.
#
# build-essential (gcc/g++/make): better-sqlite3 is a native Node addon. It
# ships a prebuilt binary for Linux+Node22 (this image's own combo, see the
# node:22-slim note above) so this usually isn't needed at all here — but
# "usually" wasn't good enough locally on Windows, where no prebuilt existed
# for the active Node version and there was no C++ toolchain to fall back on.
# Installed as a guaranteed fallback so `npm ci` below can always compile it
# if some future platform/Node combo ever lacks a matching prebuilt.
# Pinned to an exact version — unpinned, every build could silently resolve
# a different (and unreviewed) release. --only-binary :all: refuses to fall
# back to a source distribution (which could run arbitrary code via
# setup.py) for garmy or any of its dependencies — if a future garmy release
# needs a platform without prebuilt wheels, this fails loudly at build time
# rather than silently executing unreviewed install-time code.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip build-essential \
  && rm -rf /var/lib/apt/lists/* \
  && pip3 install --no-cache-dir --break-system-packages --only-binary :all: "garmy[localdb]==2.0.0"

WORKDIR /app

# .dockerignore (repo root) excludes node_modules and .env* — critical, not
# just for image size: a locally-built node_modules would carry
# Windows-compiled native addons (better-sqlite3) into this Linux image, and
# .env files must never end up baked into an image layer. `npm ci` below does
# a fresh, correctly-targeted install instead.
COPY . .
# --ignore-scripts: skip arbitrary lifecycle scripts from npm dependencies.
# better-sqlite3 has no install/postinstall script of its own (verified) —
# npm's *implicit* node-gyp rebuild from its root binding.gyp still runs
# scriptless installs, so this is safe without also losing that build step.
RUN npm ci --ignore-scripts
# node_modules/.bin, not `npx` — turbo is already an installed devDependency
# pinned by package-lock.json; `npx` would fall back to fetching an
# unpinned, unreviewed version on-demand if it were ever missing locally.
RUN node_modules/.bin/turbo build --filter=@goalsplit/api

# Stays on root rather than switching to the image's built-in `node` user.
# Tried that (a real SonarQube hardening suggestion) and it broke Garmin sync
# in production: `chown -R node:node /app` only covers /app, but the Railway
# Volume (GARMY_DB_PATH's directory) is mounted later, at container start,
# not at build time — it keeps whatever ownership Railway gives it, which
# the non-root user couldn't write to ("attempt to write a readonly
# database"). The correct fix for that is an entrypoint script that chowns
# the Volume at startup (while still root) before dropping to a non-root
# user to actually run the app — more moving parts than this single-service
# app's actual risk profile justifies right now, so staying on root instead.

ENV PORT=3001
EXPOSE 3001
CMD ["node", "apps/api/dist/index.js"]
