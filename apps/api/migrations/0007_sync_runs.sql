-- Baseline (part 7 of 7): one row per Strava/Garmin sync attempt — the
-- pipeline's audit trail and the source of the dashboard's sync status.
-- `details` holds source-specific progress (rate-limit usage, list cursor,
-- Garmin backfill cursor). Rows still 'running' at startup belong to a
-- process that died mid-sync and are marked 'interrupted'
-- (src/services/sync-runs.service.ts).

-- Up Migration

CREATE TABLE IF NOT EXISTS sync_runs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source      TEXT NOT NULL CHECK (source IN ('strava', 'garmin')),
  mode        TEXT NOT NULL,
  trigger     TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('running', 'ok', 'partial', 'failed', 'interrupted')),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  items       INTEGER NOT NULL DEFAULT 0,
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  error       TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_user_source ON sync_runs (user_id, source, started_at DESC);
