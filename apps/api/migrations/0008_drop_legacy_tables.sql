-- Drops the tables left behind by the 2026-09-08 pivot from fitness dashboard
-- to training analytics: goal setting, personal-best tracking (superseded by
-- manual_prs + Strava best efforts) and nutrition/weight tracking. No code
-- has read or written them since. Their data is discarded deliberately.
--
-- No CASCADE: if anything unexpected still depended on these tables the
-- migration should fail loudly rather than silently drop it. meals goes
-- before foods_cache because of meals.fdc_id → foods_cache.
--
-- Irreversible (no down migration): the data is gone.

-- Up Migration

DROP TABLE IF EXISTS meals;
DROP TABLE IF EXISTS foods_cache;
DROP TABLE IF EXISTS nutrition_profile;
DROP TABLE IF EXISTS weight_logs;
DROP TABLE IF EXISTS goals;
DROP TABLE IF EXISTS personal_bests;
