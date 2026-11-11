-- Baseline (part 2 of 7): synced Strava activities, flattened to the fields
-- the app queries. Everything else Strava returns lives in activity_dumps.

-- Up Migration

CREATE TABLE IF NOT EXISTS activities (
  id                   TEXT PRIMARY KEY,
  strava_id            BIGINT UNIQUE NOT NULL,
  user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  type                 TEXT NOT NULL,
  sport_type           TEXT NOT NULL,
  distance             DOUBLE PRECISION NOT NULL,
  moving_time          INTEGER NOT NULL,
  elapsed_time         INTEGER NOT NULL,
  total_elevation_gain DOUBLE PRECISION NOT NULL DEFAULT 0,
  average_speed        DOUBLE PRECISION NOT NULL,
  max_speed            DOUBLE PRECISION NOT NULL DEFAULT 0,
  average_heartrate    DOUBLE PRECISION,
  max_heartrate        DOUBLE PRECISION,
  start_date           TIMESTAMPTZ NOT NULL,
  start_date_local     TIMESTAMPTZ NOT NULL,
  timezone             TEXT NOT NULL DEFAULT '',
  synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Strava answered "no streams" (404/empty) — manual entries, some indoor
  -- activities. Recorded so syncs stop re-asking.
  streams_missing      BOOLEAN NOT NULL DEFAULT FALSE
);
ALTER TABLE activities ADD COLUMN IF NOT EXISTS streams_missing BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_activities_user_date ON activities (user_id, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_activities_type ON activities (user_id, type, start_date DESC);
