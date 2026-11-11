-- Baseline (part 6 of 7): all-day wellness data from Garmin's Personal API
-- (src/services/garmin-api.service.ts) — what Strava can't see.
--
-- garmin_days is the derived, rebuildable per-day row the app queries;
-- mapping_version records which derivation produced it, and rows from an
-- older version trigger a full re-sync. garmin_dumps keeps the latest raw
-- payload per (day, source) so new metrics can be derived without
-- re-fetching history — upserted, not appended, since Garmin revises recent
-- days as the watch uploads.
--
-- Replaces initSchema's `ALTER COLUMN average_heart_rate TYPE DOUBLE
-- PRECISION`, which re-ran (and locked the table) on every boot; every
-- existing database already has the DOUBLE PRECISION column.

-- Up Migration

CREATE TABLE IF NOT EXISTS garmin_days (
  id                       TEXT PRIMARY KEY,
  user_id                  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day                      DATE NOT NULL,
  resting_heart_rate       INTEGER,
  max_heart_rate           INTEGER,
  min_heart_rate           INTEGER,
  average_heart_rate       DOUBLE PRECISION,
  avg_stress_level         INTEGER,
  max_stress_level         INTEGER,
  body_battery_high        INTEGER,
  body_battery_low         INTEGER,
  sleep_duration_hours     DOUBLE PRECISION,
  training_readiness_score INTEGER,
  training_readiness_level TEXT,
  hrv_last_night_avg       DOUBLE PRECISION,
  hrv_status               TEXT,
  total_steps              INTEGER,
  synced_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deep_sleep_seconds       INTEGER,
  light_sleep_seconds      INTEGER,
  rem_sleep_seconds        INTEGER,
  awake_sleep_seconds      INTEGER,
  sleep_start_local        TEXT,
  sleep_end_local          TEXT,
  sleep_respiration_avg    DOUBLE PRECISION,
  body_battery_charged     INTEGER,
  body_battery_drained     INTEGER,
  stress_rest_seconds      INTEGER,
  stress_low_seconds       INTEGER,
  stress_medium_seconds    INTEGER,
  stress_high_seconds      INTEGER,
  mapping_version          INTEGER,
  UNIQUE (user_id, day)
);

-- Sleep stages/timing, Body Battery charge/drain and stress bands arrived
-- with the Personal API (2026-10).
ALTER TABLE garmin_days
  ADD COLUMN IF NOT EXISTS deep_sleep_seconds    INTEGER,
  ADD COLUMN IF NOT EXISTS light_sleep_seconds   INTEGER,
  ADD COLUMN IF NOT EXISTS rem_sleep_seconds     INTEGER,
  ADD COLUMN IF NOT EXISTS awake_sleep_seconds   INTEGER,
  ADD COLUMN IF NOT EXISTS sleep_start_local     TEXT,
  ADD COLUMN IF NOT EXISTS sleep_end_local       TEXT,
  ADD COLUMN IF NOT EXISTS sleep_respiration_avg DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS body_battery_charged  INTEGER,
  ADD COLUMN IF NOT EXISTS body_battery_drained  INTEGER,
  ADD COLUMN IF NOT EXISTS stress_rest_seconds   INTEGER,
  ADD COLUMN IF NOT EXISTS stress_low_seconds    INTEGER,
  ADD COLUMN IF NOT EXISTS stress_medium_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS stress_high_seconds   INTEGER,
  ADD COLUMN IF NOT EXISTS mapping_version       INTEGER;

CREATE TABLE IF NOT EXISTS garmin_dumps (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day        DATE NOT NULL,
  source     TEXT NOT NULL CHECK (source IN ('daily', 'sleep', 'hrv')),
  payload    JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, day, source)
);
