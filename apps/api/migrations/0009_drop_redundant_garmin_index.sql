-- idx_garmin_days_user_day (user_id, day DESC) duplicates the unique
-- (user_id, day) index behind garmin_days_user_id_day_key: Postgres scans a
-- btree in either direction, so newest-first queries use the unique index
-- just as well. Dropping it saves a write per upserted day.

-- Up Migration

DROP INDEX IF EXISTS idx_garmin_days_user_day;

-- Down Migration

CREATE INDEX IF NOT EXISTS idx_garmin_days_user_day ON garmin_days (user_id, day DESC);
