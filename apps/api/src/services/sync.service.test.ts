import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/index.js", () => ({
  sql: Object.assign(vi.fn(), { json: vi.fn((v: unknown) => v) }),
  initSchema: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/strava-client.js", () => ({
  fetchActivities: vi.fn(),
  fetchActivityDetail: vi.fn(),
}));

vi.mock("./token.service.js", () => ({
  getValidAccessToken: vi.fn(),
}));

import { sql } from "../db/index.js";
import { fetchActivities, fetchActivityDetail } from "../lib/strava-client.js";
import { getValidAccessToken } from "./token.service.js";
import { syncActivities } from "./sync.service.js";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;
const mockFetchActivities = fetchActivities as unknown as ReturnType<typeof vi.fn>;
const mockFetchActivityDetail = fetchActivityDetail as unknown as ReturnType<typeof vi.fn>;
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

beforeEach(() => {
  vi.clearAllMocks();
  mockGetToken.mockResolvedValue("token-abc");
});

describe("syncActivities", () => {
  it("throws when Strava is not connected", async () => {
    mockGetToken.mockResolvedValue(null);
    await expect(syncActivities("user-1")).rejects.toThrow("Not connected to Strava");
  });

  it("fetches and stores a detail dump for newly-inserted activities", async () => {
    mockSql.mockResolvedValueOnce([{ last_ts: null }]); // getLastActivityTimestamp
    mockFetchActivities.mockResolvedValueOnce({
      activities: [makeActivity()],
      usage: { fifteenMin: 1, daily: 1 },
      limit: { fifteenMin: 100, daily: 1000 },
    });
    mockSql.mockResolvedValueOnce([{ id: "act-1", inserted: true }]); // upsertActivity
    mockSql.mockResolvedValueOnce([]); // insertDump: list
    mockFetchActivityDetail.mockResolvedValueOnce({
      detail: { splits_metric: [] },
      usage: { fifteenMin: 2, daily: 2 },
      limit: { fifteenMin: 100, daily: 1000 },
    });
    mockSql.mockResolvedValueOnce([]); // insertDump: detail

    const result = await syncActivities("user-1");

    expect(mockFetchActivityDetail).toHaveBeenCalledWith("token-abc", 123);
    expect(result.synced).toBe(1);
  });

  it("does not fetch a detail dump for activities already in the DB", async () => {
    mockSql.mockResolvedValueOnce([{ last_ts: null }]);
    mockFetchActivities.mockResolvedValueOnce({
      activities: [makeActivity()],
      usage: { fifteenMin: 1, daily: 1 },
      limit: { fifteenMin: 100, daily: 1000 },
    });
    mockSql.mockResolvedValueOnce([{ id: "act-1", inserted: false }]); // upsertActivity
    mockSql.mockResolvedValueOnce([]); // insertDump: list

    await syncActivities("user-1");

    expect(mockFetchActivityDetail).not.toHaveBeenCalled();
  });

  it("full backfill ignores the last-synced cursor and backfills a missing detail dump", async () => {
    mockFetchActivities.mockResolvedValueOnce({
      activities: [makeActivity()],
      usage: { fifteenMin: 1, daily: 1 },
      limit: { fifteenMin: 100, daily: 1000 },
    });
    mockSql.mockResolvedValueOnce([{ id: "act-1", inserted: false }]); // upsertActivity (already existed)
    mockSql.mockResolvedValueOnce([]); // insertDump: list
    mockSql.mockResolvedValueOnce([{ exists: false }]); // hasDetailDump
    mockFetchActivityDetail.mockResolvedValueOnce({
      detail: {},
      usage: { fifteenMin: 2, daily: 2 },
      limit: { fifteenMin: 100, daily: 1000 },
    });
    mockSql.mockResolvedValueOnce([]); // insertDump: detail

    await syncActivities("user-1", { full: true });

    // No getLastActivityTimestamp call — after should be undefined, not a cursor.
    expect(mockFetchActivities).toHaveBeenCalledWith("token-abc", {
      after: undefined,
      page: 1,
      perPage: 200,
    });
    expect(mockFetchActivityDetail).toHaveBeenCalledWith("token-abc", 123);
  });

  it("full backfill does not re-fetch a detail dump that's already stored", async () => {
    mockFetchActivities.mockResolvedValueOnce({
      activities: [makeActivity()],
      usage: { fifteenMin: 1, daily: 1 },
      limit: { fifteenMin: 100, daily: 1000 },
    });
    mockSql.mockResolvedValueOnce([{ id: "act-1", inserted: false }]); // upsertActivity
    mockSql.mockResolvedValueOnce([]); // insertDump: list
    mockSql.mockResolvedValueOnce([{ exists: true }]); // hasDetailDump

    await syncActivities("user-1", { full: true });

    expect(mockFetchActivityDetail).not.toHaveBeenCalled();
  });

  it("skips the detail fetch once the 15-minute rate budget is nearly exhausted", async () => {
    mockSql.mockResolvedValueOnce([{ last_ts: null }]);
    mockFetchActivities.mockResolvedValueOnce({
      activities: [makeActivity()],
      usage: { fifteenMin: 85, daily: 85 },
      limit: { fifteenMin: 100, daily: 1000 },
    });
    mockSql.mockResolvedValueOnce([{ id: "act-1", inserted: true }]); // upsertActivity
    mockSql.mockResolvedValueOnce([]); // insertDump: list

    await syncActivities("user-1");

    expect(mockFetchActivityDetail).not.toHaveBeenCalled();
  });
});
