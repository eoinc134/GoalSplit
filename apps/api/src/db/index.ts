import postgres from "postgres";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL env var is not set");
}

export const sql = postgres(process.env.DATABASE_URL, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
});

export async function initSchema(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      strava_athlete_id BIGINT UNIQUE NOT NULL,
      username      TEXT,
      firstname     TEXT,
      lastname      TEXT,
      profile_url   TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // One token row per user (user_id is the PK — 1-to-1 relationship)
  await sql`
    CREATE TABLE IF NOT EXISTS strava_tokens (
      user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      access_token  TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at    BIGINT NOT NULL,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
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
      synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_activities_user_date
      ON activities (user_id, start_date DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_activities_type
      ON activities (user_id, type, start_date DESC)
  `;

  // Append-only audit log of raw Strava payloads per activity. We flatten only
  // what the app needs into `activities`; this keeps everything else (splits,
  // laps, best efforts, description, time-series streams, ...) around for
  // richer exports/analytics later without having to re-fetch from Strava or
  // migrate columns for every new field.
  await sql`
    CREATE TABLE IF NOT EXISTS activity_dumps (
      id          TEXT PRIMARY KEY,
      activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      strava_id   BIGINT NOT NULL,
      source      TEXT NOT NULL CHECK (source IN ('list', 'detail', 'streams')),
      payload     JSONB NOT NULL,
      fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Migration: 'streams' was added as a dump source after launch — widen the
  // CHECK constraint on databases created before this existed.
  await sql`ALTER TABLE activity_dumps DROP CONSTRAINT IF EXISTS activity_dumps_source_check`;
  await sql`
    ALTER TABLE activity_dumps ADD CONSTRAINT activity_dumps_source_check
      CHECK (source IN ('list', 'detail', 'streams'))
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_activity_dumps_activity
      ON activity_dumps (activity_id, fetched_at DESC)
  `;

  // Manually-entered personal records: gaps Strava's best_efforts can't cover
  // (pre-Strava races, distances Strava doesn't auto-detect, corrections).
  // No FK to activity_dumps — independent of Strava data entirely. Deliberately
  // not shaped like the old, removed `personal_bests` table (no goal_time/
  // goal_pace/priority/run_id — this is achieved times only).
  await sql`
    CREATE TABLE IF NOT EXISTS manual_prs (
      id                 TEXT PRIMARY KEY,
      user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      distance_label     TEXT NOT NULL CHECK (char_length(distance_label) BETWEEN 1 AND 60),
      time_seconds       INTEGER NOT NULL CHECK (time_seconds > 0),
      achieved_date      DATE NOT NULL,
      notes              TEXT,
      -- Optional provenance: set when this entry corrects a specific synced
      -- activity Strava's own distance-matching missed (e.g. a true 10K effort
      -- that GPS-recorded as 9.9km, so Strava never generated a "10K"
      -- best_efforts entry for it at all — no re-sync will ever fix that).
      -- ON DELETE SET NULL, not CASCADE: losing the linked activity should
      -- never delete the user's manually-preserved record, just orphan the link.
      source_activity_id TEXT REFERENCES activities(id) ON DELETE SET NULL,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_manual_prs_user ON manual_prs (user_id)
  `;

  // All-day wellness metrics Strava structurally can't provide (it only sees
  // HR during a recorded activity) — synced from garmy's local SQLite mirror
  // of Garmin Connect (see apps/api/src/services/garmin-sync.service.ts). This
  // is a derived, re-buildable copy for this app's own queries, not a second
  // independent source of truth — garmy's own SQLite file plays the
  // "never re-fetch" cache role that activity_dumps plays for Strava.
  await sql`
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
      UNIQUE (user_id, day)
    )
  `;

  // Migration: average_heart_rate was originally INTEGER, but garmy computes
  // it as a mean across intraday readings (e.g. 58.9466...), which an
  // INTEGER column rejects outright — caught by an end-to-end test against
  // real data, not by any prior unit test (their fixtures all used
  // whole-number fixtures). Widening is a no-op on a column already
  // DOUBLE PRECISION.
  await sql`ALTER TABLE garmin_days ALTER COLUMN average_heart_rate TYPE DOUBLE PRECISION`;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_garmin_days_user_day ON garmin_days (user_id, day DESC)
  `;

  console.log("DB schema ready");
}
