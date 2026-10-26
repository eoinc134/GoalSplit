import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../db/index.js", () => ({
  sql: vi.fn().mockResolvedValue([]),
  initSchema: vi.fn().mockResolvedValue(undefined),
}));

import { sql } from "../db/index.js";
import { defaultSyncRange, fetchGarminDays, syncGarmin } from "./garmin-api.service.js";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;
const exp = Math.floor(Date.now() / 1000) + 24 * 3600;
const TOKEN = `h.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.s`;

function respond(status: number, body?: unknown, text?: string): Response {
  return new Response(text ?? (body === undefined ? null : JSON.stringify(body)), { status });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GARMIN_API = `test-key-${Math.random()}`; // fresh key → no token cached between tests
  fetchMock = vi.fn(async (url: string) => {
    if (url.includes("personal-api-key/token")) return respond(200, undefined, TOKEN);
    if (url.includes("dailysummaries")) {
      return respond(200, {
        data: [
          {
            calendarDate: "2026-10-20",
            includesWellnessData: true,
            heartRate: { minValue: 39, restingValue: 40 },
            stress: { totalDurationInMillis: 86_000_000 },
          },
        ],
      });
    }
    if (url.includes("dailySleepSummariesByDate")) return respond(200, [{ calendarDate: "2026-10-20", sleepTimeSeconds: 28_800 }]);
    if (url.includes("hrv-service")) return respond(204);
    return respond(404);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Garmin Personal API service", () => {
  it("exchanges the key once, then pulls summaries, sleep and HRV with the bearer token", async () => {
    const points = await fetchGarminDays("2026-10-20", "2026-10-21");

    expect(points).toEqual([expect.objectContaining({ day: "2026-10-20", restingHeartRate: 40, sleepDurationHours: 8 })]);
    const tokenCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("token"));
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0][1]).toMatchObject({ method: "POST", headers: { Authorization: `ApiKey ${process.env.GARMIN_API}` } });
    const dataCall = fetchMock.mock.calls.find(([url]) => String(url).includes("dailysummaries"))!;
    expect(dataCall[1]).toMatchObject({ headers: { Authorization: `Bearer ${TOKEN}` } });
  });

  it("chunks long ranges: a year of sleep takes 14 requests of 28 days", async () => {
    await fetchGarminDays("2025-10-22", "2026-10-21");
    const sleepCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("dailySleepSummariesByDate"));
    const dailyCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("dailysummaries"));
    expect(sleepCalls).toHaveLength(14);
    expect(dailyCalls).toHaveLength(5);
  });

  it("reports an expired or revoked key clearly", async () => {
    fetchMock.mockImplementationOnce(async () => respond(401));
    await expect(fetchGarminDays("2026-10-20", "2026-10-20")).rejects.toThrow("GARMIN_KEY_REJECTED");
  });

  it("refuses to run without a key", async () => {
    delete process.env.GARMIN_API;
    await expect(fetchGarminDays("2026-10-20", "2026-10-20")).rejects.toThrow("GARMIN_NOT_CONFIGURED");
  });

  it("upserts one row per day", async () => {
    const result = await syncGarmin("user-1", "2026-10-20", "2026-10-21");
    expect(result).toEqual({ synced: 1 });
    expect(mockSql).toHaveBeenCalledTimes(1);
  });
});

describe("defaultSyncRange", () => {
  it("backfills from the first Strava activity when there's no older history — even with recent rows present", async () => {
    mockSql.mockResolvedValueOnce([{ has_history: false, first_activity: "2024-02-06" }]);
    expect(await defaultSyncRange("user-1", "2026-10-26")).toEqual({ start: "2024-02-06", end: "2026-10-26" });
  });

  it("re-reads only the last week once history exists", async () => {
    mockSql.mockResolvedValueOnce([{ has_history: true, first_activity: "2024-02-06" }]);
    expect(await defaultSyncRange("user-1", "2026-10-26")).toEqual({ start: "2026-10-20", end: "2026-10-26" });
  });
});
