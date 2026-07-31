import type postgres from "postgres";
import { sql } from "../db/index.js";
import {
  fetchActivities,
  fetchActivityDetail,
  type StravaActivityResponse,
} from "../lib/strava-client.js";
import { getValidAccessToken } from "./token.service.js";
import type { SyncResult } from "@goalsplit/types";

// Returns the Unix timestamp of the most recent activity in the DB, or null for a full sync.
async function getLastActivityTimestamp(userId: string): Promise<number | null> {
  const [row] = await sql<{ last_ts: number | null }[]>`
    SELECT EXTRACT(EPOCH FROM MAX(start_date))::INTEGER AS last_ts
    FROM activities
    WHERE user_id = ${userId}
  `;
  return row?.last_ts ?? null;
}

// Upserts the flattened row and returns its internal id plus whether this was
// a brand-new activity (vs. re-syncing one we already had).
async function upsertActivity(
  userId: string,
  act: StravaActivityResponse,
): Promise<{ id: string; inserted: boolean }> {
  const [row] = await sql<{ id: string; inserted: boolean }[]>`
    INSERT INTO activities (
      id, strava_id, user_id, name, type, sport_type,
      distance, moving_time, elapsed_time, total_elevation_gain,
      average_speed, max_speed, average_heartrate, max_heartrate,
      start_date, start_date_local, timezone, synced_at
    ) VALUES (
      ${crypto.randomUUID()}, ${act.id}, ${userId}, ${act.name}, ${act.type}, ${act.sport_type},
      ${act.distance}, ${act.moving_time}, ${act.elapsed_time}, ${act.total_elevation_gain ?? 0},
      ${act.average_speed}, ${act.max_speed ?? 0}, ${act.average_heartrate ?? null}, ${act.max_heartrate ?? null},
      ${act.start_date}, ${act.start_date_local}, ${act.timezone ?? ""},
      NOW()
    )
    ON CONFLICT (strava_id) DO UPDATE SET
      name      = EXCLUDED.name,
      synced_at = NOW()
    RETURNING id, (xmax = 0) AS inserted
  `;
  return row;
}

async function hasDetailDump(activityId: string): Promise<boolean> {
  const [row] = await sql<{ exists: boolean }[]>`
    SELECT EXISTS(
      SELECT 1 FROM activity_dumps WHERE activity_id = ${activityId} AND source = 'detail'
    ) AS exists
  `;
  return row?.exists ?? false;
}

// Append-only audit dump — one row per (activity, source) observation.
async function insertDump(
  activityId: string,
  stravaId: number,
  source: "list" | "detail",
  payload: unknown,
): Promise<void> {
  await sql`
    INSERT INTO activity_dumps (id, activity_id, strava_id, source, payload)
    VALUES (${crypto.randomUUID()}, ${activityId}, ${stravaId}, ${source}, ${sql.json(payload as postgres.JSONValue)})
  `;
}

// Strava limits: 100 req/15min (read), 1000 req/day.
// We stop making further requests once we've used ≥80% of the 15-minute read quota.
const RATE_LIMIT_SAFE_THRESHOLD = 0.8;

// Upserts one activity, always dumping its list payload, and dumps the richer
// detail payload too when it's missing — either because the activity is brand
// new, or (during a full backfill) because it predates this feature — as long
// as there's rate-limit headroom. Returns the rate fraction observed afterwards.
async function syncOneActivity(
  userId: string,
  accessToken: string,
  act: StravaActivityResponse,
  rateFraction: number,
  full: boolean,
): Promise<number> {
  const { id, inserted } = await upsertActivity(userId, act);
  await insertDump(id, act.id, "list", act);

  const needsDetail = inserted || (full && !(await hasDetailDump(id)));
  if (!needsDetail || rateFraction >= RATE_LIMIT_SAFE_THRESHOLD) return rateFraction;

  const { detail, usage, limit } = await fetchActivityDetail(accessToken, act.id);
  await insertDump(id, act.id, "detail", detail);
  return limit.fifteenMin > 0 ? usage.fifteenMin / limit.fifteenMin : 0;
}

export interface SyncOptions {
  // Ignores the "only fetch activities newer than our latest" cursor and walks
  // the full Strava history instead, backfilling dumps for activities synced
  // before dumps existed. Rate-limit-safe and resumable across multiple calls.
  full?: boolean;
}

export async function syncActivities(userId: string, options: SyncOptions = {}): Promise<SyncResult> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) throw new Error("Not connected to Strava");

  const after = options.full ? null : await getLastActivityTimestamp(userId);
  let page = 1;
  let totalSynced = 0;
  let rateFraction = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { activities, usage, limit } = await fetchActivities(accessToken, {
      after: after ?? undefined,
      page,
      perPage: 200,
    });
    rateFraction = limit.fifteenMin > 0 ? usage.fifteenMin / limit.fifteenMin : 0;

    for (const act of activities) {
      rateFraction = await syncOneActivity(userId, accessToken, act, rateFraction, options.full ?? false);
      totalSynced++;
    }

    const isLastPage = activities.length < 200;

    if (isLastPage || rateFraction >= RATE_LIMIT_SAFE_THRESHOLD) break;

    page++;
    // Small pause between pages to stay friendly with the API
    await new Promise((r) => setTimeout(r, 300));
  }

  return { synced: totalSynced, pages: page };
}
