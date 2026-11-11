-- Baseline (part 4 of 7): derived, rebuildable summary of each activity's
-- streams (HR histogram, quarter splits, grade-adjusted pace) — see
-- src/lib/activity-metrics.ts. Saves analytics from re-reading
-- multi-hundred-KB stream payloads. `metrics` is NULL when the streams were
-- unusable, so the row still records the activity was processed at `version`.

-- Up Migration

CREATE TABLE IF NOT EXISTS activity_metrics (
  activity_id TEXT PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  metrics     JSONB,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
