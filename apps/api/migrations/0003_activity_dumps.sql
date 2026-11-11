-- Baseline (part 3 of 7): append-only log of raw Strava payloads per
-- activity — the list entry, the detail payload (splits, laps, best efforts,
-- description, …) and the time-series streams. The source of truth for
-- anything richer than the flattened activities row; nothing needs
-- re-fetching from Strava.
--
-- Replaces initSchema's drop-and-re-add of the source CHECK on every boot
-- (which locked the table and re-checked every row on each deploy). Every
-- existing database already has the widened ('list','detail','streams')
-- constraint, created inline here as activity_dumps_source_check.

-- Up Migration

CREATE TABLE IF NOT EXISTS activity_dumps (
  id          TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  strava_id   BIGINT NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('list', 'detail', 'streams')),
  payload     JSONB NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_dumps_activity ON activity_dumps (activity_id, fetched_at DESC);
