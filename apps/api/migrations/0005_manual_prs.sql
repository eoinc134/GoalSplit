-- Baseline (part 5 of 7): manually entered personal records — gaps Strava's
-- best efforts can't cover (pre-Strava races, distances Strava doesn't
-- detect, corrections). Achieved times only; unrelated to the removed
-- personal_bests table (dropped in 0008).

-- Up Migration

CREATE TABLE IF NOT EXISTS manual_prs (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  distance_label     TEXT NOT NULL CHECK (char_length(distance_label) BETWEEN 1 AND 60),
  time_seconds       INTEGER NOT NULL CHECK (time_seconds > 0),
  achieved_date      DATE NOT NULL,
  notes              TEXT,
  -- Optional provenance: the synced activity this entry corrects (e.g. a true
  -- 10K that GPS recorded as 9.9 km, so Strava never produced a 10K best
  -- effort). SET NULL, not CASCADE: losing the activity must never delete the
  -- record, only orphan the link.
  source_activity_id TEXT REFERENCES activities(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_manual_prs_user ON manual_prs (user_id);
