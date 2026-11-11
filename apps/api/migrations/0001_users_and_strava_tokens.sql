-- Baseline (part 1 of 7): the athlete and their Strava OAuth tokens.
--
-- Migrations 0001–0007 capture the schema as it stood when migrations were
-- introduced (2026-11), replacing the old run-everything-on-boot initSchema().
-- Each creates its tables in their final shape on a fresh database, and adds
-- any later columns with IF NOT EXISTS, so applying them to an existing
-- database changes nothing. No down migration: undoing a baseline would mean
-- dropping live tables.

-- Up Migration

CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,
  strava_athlete_id BIGINT UNIQUE NOT NULL,
  username          TEXT,
  firstname         TEXT,
  lastname          TEXT,
  profile_url       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Picks the Banister TRIMP sex coefficient; set from the Strava profile on
  -- (re)connect.
  sex               TEXT
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS sex TEXT;

-- One token row per user (user_id is the PK — 1-to-1). Tokens are stored
-- AES-256-GCM encrypted when TOKEN_ENCRYPTION_KEY is set (lib/token-crypto.ts).
CREATE TABLE IF NOT EXISTS strava_tokens (
  user_id            TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  access_token       TEXT NOT NULL,
  refresh_token      TEXT NOT NULL,
  expires_at         BIGINT NOT NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Set when Strava rejects the stored token (access revoked, refresh token
  -- invalid); cleared when a new sign-in saves fresh tokens.
  reauth_required_at TIMESTAMPTZ
);
ALTER TABLE strava_tokens ADD COLUMN IF NOT EXISTS reauth_required_at TIMESTAMPTZ;
