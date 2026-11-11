import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/index.js", () => ({
  sql: Object.assign(vi.fn(), { json: vi.fn((v: unknown) => v) }),
}));

vi.mock("../lib/strava-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/strava-client.js")>()),
  fetchActivities: vi.fn(),
  fetchActivityDetail: vi.fn(),
  fetchActivityStreams: vi.fn(),
}));

vi.mock("./token.service.js", () => ({
  getValidAccessToken: vi.fn(),
  markReauthRequired: vi.fn(),
  STRAVA_REAUTH_REQUIRED: "STRAVA_REAUTH_REQUIRED",
}));

// Run tracking/locking has its own tests; here it just runs the body.
vi.mock("./sync-runs.service.js", () => ({
  trackSyncRun: vi.fn(async (_opts: unknown, fn: (ctx: unknown) => Promise<{ result: unknown }>) =>
    (await fn({ runId: "run-1", saveProgress: vi.fn() })).result,
  ),
}));

import { sql } from "../db/index.js";
import {
  fetchActivities,
  fetchActivityDetail,
  fetchActivityStreams,
  StravaAuthError,
  type RateInfo,
} from "../lib/strava-client.js";
import { getValidAccessToken, markReauthRequired } from "./token.service.js";
import { syncActivities } from "./sync.service.js";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;
const mockFetchActivities = vi.mocked(fetchActivities);
const mockDetail = vi.mocked(fetchActivityDetail);
const mockStreams = vi.mocked(fetchActivityStreams);

function rate(fraction: number, window: RateInfo["window"] = "fifteenMin"): RateInfo {
  return { fraction, window, fifteenMin: null, daily: null };
}
const LOW = rate(0.01);

function makeActivity(id = 123) {
  return {
    id,
    name: "Morning Run",
    type: "Run",
    sport_type: "Run",
    distance: 10000,
    moving_time: 2400,
    elapsed_time: 2450,
    total_elevation_gain: 50,
    average_speed: 4.17,
    max_speed: 5,
    start_date: "2025-06-01T08:00:00Z",
    start_date_local: "2025-06-01T09:00:00Z",
    timezone: "Europe/Dublin",
  };
}

// A tiny stand-in for Postgres, keyed on query text, so tests describe
// behaviour rather than the exact order of SQL calls.
interface DbState {
  lastTs: number | null;
  unfinished: { list_complete: boolean | null; after: string | null } | null;
  existing: Set<number>; // strava ids already in activities
  needs: { has_detail: boolean; needs_streams: boolean }; // for existing activities (full mode)
  missing: { id: string; strava_id: string; has_detail: boolean; needs_streams: boolean }[];
  pendingCount: number;
  dumps: string[]; // sources inserted
  streamsMissing: string[]; // activity ids flagged
}
let db: DbState;

function installDb() {
  mockSql.mockImplementation((strings: TemplateStringsArray | string[], ...values: unknown[]) => {
    const q = Array.isArray(strings) ? strings.join("?") : "";
    if (q.includes("MAX(start_date)")) return Promise.resolve([{ last_ts: db.lastTs }]);
    if (q.includes("FROM sync_runs")) return Promise.resolve(db.unfinished ? [db.unfinished] : []);
    if (q.includes("INSERT INTO activities")) {
      const stravaId = values[1] as number;
      return Promise.resolve([{ id: `act-${stravaId}`, inserted: !db.existing.has(stravaId) }]);
    }
    if (q.includes("INSERT INTO activity_dumps")) {
      db.dumps.push(values[3] as string);
      return Promise.resolve([]);
    }
    if (q.includes("SET streams_missing")) {
      db.streamsMissing.push(values[0] as string);
      return Promise.resolve([]);
    }
    if (q.includes("COUNT(*)")) return Promise.resolve([{ count: String(db.pendingCount) }]);
    if (q.includes("ORDER BY a.start_date DESC")) return Promise.resolve(db.missing);
    if (q.includes("WHERE a.id")) return Promise.resolve([db.needs]);
    return Promise.resolve([]); // sql`` fragments and anything else
  });
}

function onePage(activities = [makeActivity()], r: RateInfo = LOW) {
  mockFetchActivities.mockResolvedValueOnce({ activities, rate: r });
}

beforeEach(() => {
  vi.clearAllMocks();
  db = {
    lastTs: null,
    unfinished: null,
    existing: new Set(),
    needs: { has_detail: true, needs_streams: false },
    missing: [],
    pendingCount: 0,
    dumps: [],
    streamsMissing: [],
  };
  installDb();
  vi.mocked(getValidAccessToken).mockResolvedValue("token-abc");
  mockDetail.mockResolvedValue({ detail: {}, rate: LOW });
  mockStreams.mockResolvedValue({ streams: { time: { data: [0, 1, 2] } }, rate: LOW });
});

describe("syncActivities", () => {
  it("throws when Strava is not connected", async () => {
    vi.mocked(getValidAccessToken).mockResolvedValue(null);
    await expect(syncActivities("user-1")).rejects.toThrow("Not connected to Strava");
  });

  it("stores list, detail and streams dumps for a new activity and reports a complete sync", async () => {
    onePage();
    const result = await syncActivities("user-1");

    expect(db.dumps).toEqual(["list", "detail", "streams"]);
    expect(result).toMatchObject({ synced: 1, inserted: 1, detailsFetched: 1, streamsFetched: 1, complete: true, stopReason: null });
  });

  it("doesn't refetch detail or streams for activities already stored", async () => {
    db.existing.add(123);
    onePage();
    await syncActivities("user-1");
    expect(mockDetail).not.toHaveBeenCalled();
    expect(mockStreams).not.toHaveBeenCalled();
    expect(db.dumps).toEqual(["list"]);
  });

  it("flags activities Strava has no streams for, so later syncs stop asking", async () => {
    mockStreams.mockResolvedValueOnce({ streams: null, rate: LOW });
    onePage();
    const result = await syncActivities("user-1");
    expect(db.dumps).toEqual(["list", "detail"]);
    expect(db.streamsMissing).toEqual(["act-123"]);
    expect(result.streamsMissing).toBe(1);
  });

  it("re-reads the last 7 days before the newest synced activity", async () => {
    db.lastTs = 1_700_000_000;
    onePage([]);
    await syncActivities("user-1");
    expect(mockFetchActivities.mock.calls[0][1]).toMatchObject({ after: 1_700_000_000 - 7 * 86_400 });
  });

  it("resumes from an earlier, unfinished sync's cursor when that's further back", async () => {
    db.lastTs = 1_700_000_000;
    db.unfinished = { list_complete: false, after: "1600000000" };
    onePage([]);
    await syncActivities("user-1");
    expect(mockFetchActivities.mock.calls[0][1]).toMatchObject({ after: 1_600_000_000 });
  });

  it("walks the whole list again when an unfinished first sync had no cursor", async () => {
    db.lastTs = 1_700_000_000;
    db.unfinished = { list_complete: false, after: null };
    onePage([]);
    await syncActivities("user-1");
    expect(mockFetchActivities.mock.calls[0][1]).toMatchObject({ after: undefined });
  });

  it("repairs activities a previous, rate-limited sync saved without payloads", async () => {
    onePage([]);
    db.missing = [{ id: "act-9", strava_id: "9", has_detail: true, needs_streams: true }];
    await syncActivities("user-1");
    expect(mockDetail).not.toHaveBeenCalled();
    expect(mockStreams).toHaveBeenCalledWith("token-abc", 9);
    expect(db.dumps).toEqual(["streams"]);
  });

  it("stops enriching once the rate budget is nearly used, and reports a partial sync", async () => {
    onePage([makeActivity()], rate(0.85));
    db.pendingCount = 1;
    const result = await syncActivities("user-1");
    expect(mockDetail).not.toHaveBeenCalled();
    expect(result).toMatchObject({ complete: false, stopReason: "rate_limit_15min", pendingEnrichment: 1 });
  });

  it("says when it's the daily limit that ran out", async () => {
    onePage([makeActivity()], rate(0.9, "daily"));
    const result = await syncActivities("user-1");
    expect(result.stopReason).toBe("rate_limit_daily");
  });

  it("skips streams when the detail fetch alone used up the budget", async () => {
    mockDetail.mockResolvedValueOnce({ detail: {}, rate: rate(0.8) });
    onePage();
    await syncActivities("user-1");
    expect(mockStreams).not.toHaveBeenCalled();
  });

  it("treats a 429 mid-sync as a partial sync, keeping what was saved", async () => {
    mockDetail.mockRejectedValueOnce(new Error("RATE_LIMIT_EXCEEDED"));
    onePage();
    const result = await syncActivities("user-1");
    expect(db.dumps).toEqual(["list"]);
    expect(result).toMatchObject({ synced: 1, complete: false, stopReason: "rate_limit_15min" });
  });

  it("flags the token for reconnection when Strava rejects it", async () => {
    mockFetchActivities.mockRejectedValueOnce(new StravaAuthError("Strava API call", 401));
    await expect(syncActivities("user-1")).rejects.toThrow("STRAVA_REAUTH_REQUIRED");
    expect(markReauthRequired).toHaveBeenCalledWith("user-1", expect.stringContaining("401"));
  });

  it("full backfill ignores the cursor and fills in old activities missing payloads", async () => {
    db.lastTs = 1_700_000_000;
    db.existing.add(123);
    db.needs = { has_detail: false, needs_streams: true };
    onePage();
    await syncActivities("user-1", { full: true });
    expect(mockFetchActivities.mock.calls[0][1]).toMatchObject({ after: undefined });
    expect(db.dumps).toEqual(["list", "detail", "streams"]);
  });

  it("pages through the list until a short page", async () => {
    onePage(Array.from({ length: 200 }, (_, i) => makeActivity(1000 + i)));
    onePage([]);
    const result = await syncActivities("user-1");
    expect(mockFetchActivities).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ synced: 200, pages: 2, complete: true });
  });
});
