import postgres from "postgres";
import { seedIfEmpty } from "./seed.js";

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
  // laps, best efforts, description, ...) around for richer exports later
  // without having to re-fetch from Strava or migrate columns for every new field.
  await sql`
    CREATE TABLE IF NOT EXISTS activity_dumps (
      id          TEXT PRIMARY KEY,
      activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      strava_id   BIGINT NOT NULL,
      source      TEXT NOT NULL CHECK (source IN ('list', 'detail')),
      payload     JSONB NOT NULL,
      fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_activity_dumps_activity
      ON activity_dumps (activity_id, fetched_at DESC)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS goals (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      description   TEXT,
      category      TEXT NOT NULL,
      type          TEXT NOT NULL,
      target_value  DOUBLE PRECISION NOT NULL,
      current_value DOUBLE PRECISION NOT NULL DEFAULT 0,
      unit          TEXT NOT NULL,
      target_date   TEXT,
      status        TEXT NOT NULL DEFAULT 'active',
      prioritized   BOOLEAN NOT NULL DEFAULT false,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS personal_bests (
      id             TEXT PRIMARY KEY,
      distance       DOUBLE PRECISION NOT NULL,
      distance_label TEXT NOT NULL,
      time           INTEGER NOT NULL,
      pace           INTEGER NOT NULL,
      goal_time      INTEGER,
      goal_pace      INTEGER,
      date           TEXT NOT NULL,
      run_id         TEXT,
      notes          TEXT
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS nutrition_profile (
      id                    TEXT PRIMARY KEY DEFAULT 'singleton',
      height_cm             DOUBLE PRECISION,
      sex                   TEXT,
      birth_date            TEXT,
      activity_level        TEXT NOT NULL DEFAULT 'moderate',
      goal                  TEXT NOT NULL DEFAULT 'maintain',
      calorie_offset        INTEGER NOT NULL DEFAULT 0,
      maintenance_override  INTEGER,
      protein_g_per_kg      DOUBLE PRECISION NOT NULL DEFAULT 1.8,
      fat_pct               DOUBLE PRECISION NOT NULL DEFAULT 0.25,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS weight_logs (
      id         TEXT PRIMARY KEY,
      date       TEXT NOT NULL UNIQUE,
      weight_kg  DOUBLE PRECISION NOT NULL,
      notes      TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_weight_logs_date ON weight_logs (date DESC)
  `;

  // Cache of USDA foods actually logged, so re-adding a favorite doesn't re-hit
  // the API and it powers a "recent foods" quick-add list.
  await sql`
    CREATE TABLE IF NOT EXISTS foods_cache (
      fdc_id              TEXT PRIMARY KEY,
      description         TEXT NOT NULL,
      brand_owner         TEXT,
      calories_per_100g   DOUBLE PRECISION NOT NULL,
      protein_g_per_100g  DOUBLE PRECISION NOT NULL,
      carbs_g_per_100g    DOUBLE PRECISION NOT NULL,
      fat_g_per_100g      DOUBLE PRECISION NOT NULL,
      cached_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS meals (
      id          TEXT PRIMARY KEY,
      date        TEXT NOT NULL,
      meal_type   TEXT NOT NULL DEFAULT 'other',
      name        TEXT NOT NULL,
      quantity_g  DOUBLE PRECISION,
      fdc_id      TEXT REFERENCES foods_cache(fdc_id),
      calories    DOUBLE PRECISION NOT NULL,
      protein_g   DOUBLE PRECISION NOT NULL,
      carbs_g     DOUBLE PRECISION NOT NULL,
      fat_g       DOUBLE PRECISION NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_meals_date ON meals (date DESC)
  `;

  await seedIfEmpty(sql);

  console.log("DB schema ready");
}
