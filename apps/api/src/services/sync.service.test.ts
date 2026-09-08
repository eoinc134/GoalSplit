import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/index.js", () => ({
  sql: Object.assign(vi.fn(), { json: vi.fn((v: unknown) => v) }),
  initSchema: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/strava-client.js", () => ({
  fetchActivities: vi.fn(),
  fetchActivityDetail: vi.fn(),
  fetchActivityStreams: vi.fn(),
}));

vi.mock("./token.service.js", () => ({
  getValidAccessToken: vi.fn(),
}));

import { sql } from "../db/index.js";
import { fetchActivities, fetchActivityDetail, fetchActivityStreams } from "../lib/strava-client.js";
import { getValidAccessToken } from "./token.service.js";
import { syncActivities } from "./sync.service.js";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;
const mockFetchActivities = fetchActivities as unknown as ReturnType<typeof vi.fn>;
const mockFetchActivityDetail = fetchActivityDetail as unknown as ReturnType<typeof vi.fn>;
const mockFetchActivityStreams = fetchActivityStreams as unknown as ReturnType<typeof vi.fn>;
const mockGetToken = getValidAccessToken as unknown as ReturnType<typeof vi.fn>;

function makeActivity(overrides: Record<string, unknown> = {}) {
  return {
    id: 123,
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
    ...overrides,
  };
}

const LOW_USAGE = { fifteenMin: 1, daily: 1 };
const LIMIT = { fifteenMin: 100, daily: 1000 };

// Queues one activity page from `fetchActivities`, with an optional rate-usage override.
function mockActivitiesPage(usage: { fifteenMin: number; daily: number } = LOW_USAGE) {
  mockFetchActivities.mockResolvedValueOnce({ activities: [makeActivity()], usage, limit: LIMIT });
}

// Queues successive `sql` resolved values in call order — each array is one call's row set.
function queueSql(...responses: unknown[][]) {
  for (const response of responses) mockSql.mockResolvedValueOnce(response);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetToken.mockResolvedValue("token-abc");
  mockFetchActivityDetail.mockResolvedValue({ detail: {}, usage: LOW_USAGE, limit: LIMIT });
  mockFetchActivityStreams.mockResolvedValue({
    streams: { time: { data: [0, 1, 2] } },
    usage: LOW_USAGE,
    limit: LIMIT,
  });
});

describe("syncActivities", () => {
  it("throws when Strava is not connected", async () => {
    mockGetToken.mockResolvedValue(null);
    await expect(syncActivities("user-1")).rejects.toThrow("Not connected to Strava");
  });

  it("fetches and stores detail and streams dumps for newly-inserted activities", async () => {
    // getLastActivityTimestamp, upsertActivity, insertDump(list), insertDump(detail), insertDump(streams)
    queueSql([{ last_ts: null }], [{ id: "act-1", inserted: true }], [], [], []);
    mockActivitiesPage();

    const result = await syncActivities("user-1");

    expect(mockFetchActivityDetail).toHaveBeenCalledWith("token-abc", 123);
    expect(mockFetchActivityStreams).toHaveBeenCalledWith("token-abc", 123);
    expect(result.synced).toBe(1);
  });

  it("does not fetch detail or streams for activities already in the DB", async () => {
    // getLastActivityTimestamp, upsertActivity, insertDump(list)
    queueSql([{ last_ts: null }], [{ id: "act-1", inserted: false }], []);
    mockActivitiesPage();

    await syncActivities("user-1");

    expect(mockFetchActivityDetail).not.toHaveBeenCalled();
    expect(mockFetchActivityStreams).not.toHaveBeenCalled();
  });

  it("does not store a streams dump when Strava has no streams for the activity", async () => {
    // getLastActivityTimestamp, upsertActivity, insertDump(list), insertDump(detail) — no insertDump(streams)
    queueSql([{ last_ts: null }], [{ id: "act-1", inserted: true }], [], []);
    mockActivitiesPage();
    mockFetchActivityStreams.mockResolvedValueOnce({ streams: null, usage: LOW_USAGE, limit: LIMIT });

    await syncActivities("user-1");

    expect(mockSql).toHaveBeenCalledTimes(4);
  });

  it("full backfill ignores the last-synced cursor and backfills missing detail/streams dumps", async () => {
    // upsertActivity, insertDump(list), hasDump(detail), insertDump(detail), hasDump(streams), insertDump(streams)
    queueSql(
      [{ id: "act-1", inserted: false }],
      [],
      [{ exists: false }],
      [],
      [{ exists: false }],
      [],
    );
    mockActivitiesPage();

    await syncActivities("user-1", { full: true });

    // No getLastActivityTimestamp call — after should be undefined, not a cursor.
    expect(mockFetchActivities).toHaveBeenCalledWith("token-abc", {
      after: undefined,
      page: 1,
      perPage: 200,
    });
    expect(mockFetchActivityDetail).toHaveBeenCalledWith("token-abc", 123);
    expect(mockFetchActivityStreams).toHaveBeenCalledWith("token-abc", 123);
  });

  it("full backfill does not re-fetch dumps that are already stored", async () => {
    // upsertActivity, insertDump(list), hasDump(detail)=true, hasDump(streams)=true
    queueSql([{ id: "act-1", inserted: false }], [], [{ exists: true }], [{ exists: true }]);
    mockActivitiesPage();

    await syncActivities("user-1", { full: true });

    expect(mockFetchActivityDetail).not.toHaveBeenCalled();
    expect(mockFetchActivityStreams).not.toHaveBeenCalled();
  });

  it("skips detail and streams fetches once the 15-minute rate budget is nearly exhausted", async () => {
    // getLastActivityTimestamp, upsertActivity, insertDump(list)
    queueSql([{ last_ts: null }], [{ id: "act-1", inserted: true }], []);
    mockActivitiesPage({ fifteenMin: 85, daily: 85 });

    await syncActivities("user-1");

    expect(mockFetchActivityDetail).not.toHaveBeenCalled();
    expect(mockFetchActivityStreams).not.toHaveBeenCalled();
  });

  it("skips the streams fetch when the detail fetch alone exhausts the rate budget", async () => {
    // getLastActivityTimestamp, upsertActivity, insertDump(list), insertDump(detail)
    queueSql([{ last_ts: null }], [{ id: "act-1", inserted: true }], [], []);
    mockActivitiesPage();
    mockFetchActivityDetail.mockResolvedValueOnce({
      detail: {},
      usage: { fifteenMin: 90, daily: 90 },
      limit: LIMIT,
    });

    await syncActivities("user-1");

    expect(mockFetchActivityStreams).not.toHaveBeenCalled();
  });
});
