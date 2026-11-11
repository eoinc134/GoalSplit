import type postgres from "postgres";
import type { SyncResult, SyncStopReason } from "@goalsplit/types";
import { sql } from "../db/index.js";
import {
  fetchActivities,
  fetchActivityDetail,
  fetchActivityStreams,
  StravaAuthError,
  type RateInfo,
  type StravaActivityResponse,
} from "../lib/strava-client.js";
import { getValidAccessToken, markReauthRequired, STRAVA_REAUTH_REQUIRED } from "./token.service.js";
import { trackSyncRun, type SyncTrigger } from "./sync-runs.service.js";

// Returns the Unix timestamp of the most recent activity in the DB, or null for a full sync.
async function getLastActivityTimestamp(userId: string): Promise<number | null> {
  const [row] = await sql<{ last_ts: number | null }[]>`
    SELECT EXTRACT(EPOCH FROM MAX(start_date))::INTEGER AS last_ts
    FROM activities
    WHERE user_id = ${userId}
  `;
  return row?.last_ts ?? null;
}

// If the last incremental sync stopped before reading every list page, the
// next one reuses its `after` cursor, so activities it didn't reach can't
// fall into a gap whatever order Strava returned them in. Returns undefined
// when there's nothing to resume, null when the unfinished run had no cursor
// (a first sync: walk the whole list again), or the cursor to resume from.
async function getUnfinishedCursor(userId: string): Promise<number | null | undefined> {
  const [row] = await sql<{ list_complete: boolean | null; after: string | null }[]>`
    SELECT (details ->> 'listComplete')::BOOLEAN AS list_complete, details ->> 'after' AS after
    FROM sync_runs
    WHERE user_id = ${userId} AND source = 'strava' AND mode = 'incremental' AND status <> 'running'
    ORDER BY started_at DESC
    LIMIT 1
  `;
  if (!row || row.list_complete !== false) return undefined;
  return row.after === null ? null : Number(row.after);
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
      name                 = EXCLUDED.name,
      type                 = EXCLUDED.type,
      sport_type           = EXCLUDED.sport_type,
      distance             = EXCLUDED.distance,
      moving_time          = EXCLUDED.moving_time,
      elapsed_time         = EXCLUDED.elapsed_time,
      total_elevation_gain = EXCLUDED.total_elevation_gain,
      average_speed        = EXCLUDED.average_speed,
      max_speed            = EXCLUDED.max_speed,
      average_heartrate    = EXCLUDED.average_heartrate,
      max_heartrate        = EXCLUDED.max_heartrate,
      synced_at            = NOW()
    RETURNING id, (xmax = 0) AS inserted
  `;
  return row;
}

interface EnrichmentNeeds {
  id: string;
  stravaId: number;
  needsDetail: boolean;
  needsStreams: boolean;
}

async function enrichmentNeeds(activityId: string, stravaId: number): Promise<EnrichmentNeeds> {
  const [row] = await sql<{ has_detail: boolean; needs_streams: boolean }[]>`
    SELECT
      EXISTS(SELECT 1 FROM activity_dumps WHERE activity_id = ${activityId} AND source = 'detail') AS has_detail,
      (NOT a.streams_missing
        AND NOT EXISTS(SELECT 1 FROM activity_dumps WHERE activity_id = ${activityId} AND source = 'streams')) AS needs_streams
    FROM activities a WHERE a.id = ${activityId}
  `;
  return { id: activityId, stravaId, needsDetail: !row?.has_detail, needsStreams: row?.needs_streams ?? false };
}

// A fresh fragment per query (postgres.js fragments are built per use).
const missingEnrichment = () => sql`
  (NOT EXISTS (SELECT 1 FROM activity_dumps d WHERE d.activity_id = a.id AND d.source = 'detail')
   OR (NOT a.streams_missing
       AND NOT EXISTS (SELECT 1 FROM activity_dumps d WHERE d.activity_id = a.id AND d.source = 'streams')))
`;

// Activities still missing their detail payload or streams, newest first.
async function listMissingEnrichment(userId: string, limit: number): Promise<EnrichmentNeeds[]> {
  const rows = await sql<{ id: string; strava_id: string; has_detail: boolean; needs_streams: boolean }[]>`
    SELECT a.id, a.strava_id,
      EXISTS (SELECT 1 FROM activity_dumps d WHERE d.activity_id = a.id AND d.source = 'detail') AS has_detail,
      (NOT a.streams_missing
        AND NOT EXISTS (SELECT 1 FROM activity_dumps d WHERE d.activity_id = a.id AND d.source = 'streams')) AS needs_streams
    FROM activities a
    WHERE a.user_id = ${userId} AND ${missingEnrichment()}
    ORDER BY a.start_date DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    id: r.id,
    stravaId: Number(r.strava_id),
    needsDetail: !r.has_detail,
    needsStreams: r.needs_streams,
  }));
}

export async function countMissingEnrichment(userId: string): Promise<number> {
  const [row] = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count FROM activities a WHERE a.user_id = ${userId} AND ${missingEnrichment()}
  `;
  return Number(row?.count ?? 0);
}

// Append-only audit dump — one row per (activity, source) observation.
async function insertDump(
  activityId: string,
  stravaId: number,
  source: "list" | "detail" | "streams",
  payload: unknown,
): Promise<void> {
  await sql`
    INSERT INTO activity_dumps (id, activity_id, strava_id, source, payload)
    VALUES (${crypto.randomUUID()}, ${activityId}, ${stravaId}, ${source}, ${sql.json(payload as postgres.JSONValue)})
  `;
}

// A normal sync also re-reads the last week of already-synced activities, so
// edits made on Strava after syncing (run type tag, name, a cropped distance)
// come through without a full backfill. Costs no extra detail/streams calls —
// those are only fetched for activities missing them — and the list pages
// were being fetched anyway.
const RECHECK_WINDOW_S = 7 * 86_400;

// Stop making requests once either Strava bucket (overall or read) has used
// this much of its 15-minute or daily window — see parseRateInfo.
const RATE_LIMIT_SAFE_THRESHOLD = 0.8;

// Each normal sync also repairs up to this many activities still missing
// detail/streams — e.g. ones a rate-limited sync saved but couldn't enrich.
// Bounded so a scheduled sync never spends the whole quota on old history;
// Backfill History has no such cap.
const REPAIR_BATCH = 20;

class RateBudget {
  last: RateInfo | null = null;
  update(rate: RateInfo) {
    this.last = rate;
  }
  get exhausted(): boolean {
    return (this.last?.fraction ?? 0) >= RATE_LIMIT_SAFE_THRESHOLD;
  }
  get stopReason(): SyncStopReason {
    return this.last?.window === "daily" ? "rate_limit_daily" : "rate_limit_15min";
  }
}

interface Counters {
  synced: number;
  inserted: number;
  detailsFetched: number;
  streamsFetched: number;
  streamsMissing: number;
}

// Fetches whatever detail/streams payloads the activity is missing, while
// there's rate budget for each.
async function enrich(accessToken: string, needs: EnrichmentNeeds, budget: RateBudget, counters: Counters) {
  if (needs.needsDetail && !budget.exhausted) {
    const { detail, rate } = await fetchActivityDetail(accessToken, needs.stravaId);
    await insertDump(needs.id, needs.stravaId, "detail", detail);
    budget.update(rate);
    counters.detailsFetched++;
  }

  if (needs.needsStreams && !budget.exhausted) {
    const { streams, rate } = await fetchActivityStreams(accessToken, needs.stravaId);
    if (streams && Object.keys(streams).length > 0) {
      await insertDump(needs.id, needs.stravaId, "streams", streams);
      counters.streamsFetched++;
    } else {
      await sql`UPDATE activities SET streams_missing = TRUE WHERE id = ${needs.id}`;
      counters.streamsMissing++;
    }
    budget.update(rate);
  }
}

export interface SyncOptions {
  // Ignores the "only fetch activities newer than our latest" cursor and walks
  // the full Strava history instead, backfilling dumps for activities synced
  // before dumps existed. Rate-limit-safe and resumable across multiple calls.
  full?: boolean;
  trigger?: SyncTrigger;
}

async function runStravaSync(userId: string, full: boolean, saveProgress: (d: Record<string, unknown>) => Promise<void>) {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) throw new Error("Not connected to Strava");

  let after: number | null = null;
  if (!full) {
    const lastSynced = await getLastActivityTimestamp(userId);
    const recheckFrom = lastSynced === null ? null : lastSynced - RECHECK_WINDOW_S;
    const unfinished = await getUnfinishedCursor(userId);
    if (unfinished === undefined) after = recheckFrom;
    else if (unfinished === null || recheckFrom === null) after = null;
    else after = Math.min(unfinished, recheckFrom);
  }

  const budget = new RateBudget();
  const counters: Counters = { synced: 0, inserted: 0, detailsFetched: 0, streamsFetched: 0, streamsMissing: 0 };
  let page = 1;
  let listComplete = false;
  let stopReason: SyncStopReason | null = null;

  await saveProgress({ after, listComplete: false });

  try {
    // 1. Walk the activity list (new ones, plus the recheck window).
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { activities, rate } = await fetchActivities(accessToken, { after: after ?? undefined, page, perPage: 200 });
      budget.update(rate);

      for (const act of activities) {
        const { id, inserted } = await upsertActivity(userId, act);
        await insertDump(id, act.id, "list", act);
        counters.synced++;
        if (inserted) counters.inserted++;

        // New activities are enriched straight away; a full backfill also
        // fills in old activities missing payloads.
        if (inserted) await enrich(accessToken, { id, stravaId: act.id, needsDetail: true, needsStreams: true }, budget, counters);
        else if (full) await enrich(accessToken, await enrichmentNeeds(id, act.id), budget, counters);
      }

      if (activities.length < 200) {
        listComplete = true;
        break;
      }
      if (budget.exhausted) break;
      page++;
      await saveProgress({ after, pages: page - 1, listComplete: false });
      // Small pause between pages to stay friendly with the API
      await new Promise((r) => setTimeout(r, 300));
    }

    // 2. Repair pass: activities saved earlier without their payloads.
    if (!budget.exhausted) {
      for (const needs of await listMissingEnrichment(userId, full ? 1_000_000 : REPAIR_BATCH)) {
        if (budget.exhausted) break;
        await enrich(accessToken, needs, budget, counters);
      }
    }
    if (budget.exhausted) stopReason = budget.stopReason;
  } catch (err) {
    // A 429 despite the budget (other clients sharing the app's quota) stops
    // the sync like the budget would; everything saved so far stays.
    if (!(err instanceof Error && err.message === "RATE_LIMIT_EXCEEDED")) throw err;
    stopReason = budget.last?.window === "daily" ? "rate_limit_daily" : "rate_limit_15min";
  }

  const pendingEnrichment = await countMissingEnrichment(userId);
  const result: SyncResult = {
    ...counters,
    pages: page,
    complete: stopReason === null,
    stopReason,
    pendingEnrichment,
  };
  return {
    result,
    details: {
      after,
      listComplete,
      ...counters,
      pendingEnrichment,
      stopReason,
      rate: budget.last,
    },
  };
}

export async function syncActivities(userId: string, options: SyncOptions = {}): Promise<SyncResult> {
  const full = options.full ?? false;
  try {
    return await trackSyncRun(
      { userId, source: "strava", mode: full ? "full" : "incremental", trigger: options.trigger ?? "manual" },
      async (ctx) => {
        const { result, details } = await runStravaSync(userId, full, (d) => ctx.saveProgress(d));
        return { result, status: result.complete ? "ok" : "partial", items: result.synced, details };
      },
    );
  } catch (err) {
    if (err instanceof StravaAuthError) {
      await markReauthRequired(userId, err.message);
      throw new Error(STRAVA_REAUTH_REQUIRED);
    }
    throw err;
  }
}
