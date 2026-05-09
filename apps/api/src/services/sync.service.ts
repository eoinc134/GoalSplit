import { sql } from "../db/index.js";
import { fetchActivities, type StravaActivityResponse } from "../lib/strava-client.js";
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

async function upsertActivity(userId: string, act: StravaActivityResponse): Promise<void> {
  await sql`
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
  `;
}

// Strava limits: 100 req/15min (read), 1000 req/day.
// We stop paginating if we've used ≥80% of the 15-minute read quota.
const RATE_LIMIT_SAFE_THRESHOLD = 0.8;

export async function syncActivities(userId: string): Promise<SyncResult> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) throw new Error("Not connected to Strava");

  const after = await getLastActivityTimestamp(userId);
  let page = 1;
  let totalSynced = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { activities, usage, limit } = await fetchActivities(accessToken, {
      after: after ?? undefined,
      page,
      perPage: 200,
    });

    for (const act of activities) {
      await upsertActivity(userId, act);
      totalSynced++;
    }

    const rateFraction = limit.fifteenMin > 0 ? usage.fifteenMin / limit.fifteenMin : 0;
    const isLastPage = activities.length < 200;

    if (isLastPage || rateFraction >= RATE_LIMIT_SAFE_THRESHOLD) break;

    page++;
    // Small pause between pages to stay friendly with the API
    await new Promise((r) => setTimeout(r, 300));
  }

  return { synced: totalSynced, pages: page };
}
