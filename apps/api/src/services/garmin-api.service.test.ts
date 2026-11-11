import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../db/index.js", () => ({
  sql: Object.assign(vi.fn().mockResolvedValue([]), { json: vi.fn((v: unknown) => v) }),
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

  it("stores each raw payload, then upserts one row per day", async () => {
    const result = await syncGarmin("user-1", "2026-10-20", "2026-10-21");
    expect(result).toEqual({ synced: 1 });
    // One daily + one sleep payload (HRV returned 204), then one garmin_days row.
    const statements = mockSql.mock.calls.map(([strings]) => (strings as string[]).join("?"));
    expect(statements.filter((q) => q.includes("INSERT INTO garmin_dumps"))).toHaveLength(2);
    expect(statements.filter((q) => q.includes("INSERT INTO garmin_days"))).toHaveLength(1);
  });
});

describe("syncGarmin windows", () => {
  it("saves each window as it goes and records how far it got", async () => {
    const saveProgress = vi.fn().mockResolvedValue(undefined);
    await syncGarmin("user-1", "2026-01-01", "2026-06-30", { saveProgress });
    // 181 days in windows of 84 → 3 windows, progress saved after each.
    expect(saveProgress.mock.calls.map(([d]) => d.completedThrough)).toEqual(["2026-03-25", "2026-06-17", "2026-06-30"]);
  });

  it("keeps earlier windows when a later one fails", async () => {
    const saveProgress = vi.fn().mockResolvedValue(undefined);
    let dailyCalls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("personal-api-key/token")) return respond(200, undefined, TOKEN);
      if (url.includes("dailysummaries")) return ++dailyCalls === 2 ? respond(400) : respond(200, { data: [] });
      if (url.includes("dailySleepSummariesByDate")) return respond(200, []);
      return respond(204);
    });
    await expect(syncGarmin("user-1", "2026-01-01", "2026-06-30", { saveProgress })).rejects.toThrow("Garmin API 400");
    expect(saveProgress).toHaveBeenCalledTimes(1);
  });

  it("reports Garmin rate limiting clearly", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("personal-api-key/token") ? respond(200, undefined, TOKEN) : respond(429),
    );
    await expect(syncGarmin("user-1", "2026-10-20", "2026-10-21")).rejects.toThrow("GARMIN_RATE_LIMITED");
  });
});

describe("defaultSyncRange", () => {
  const TODAY = "2026-10-26";
  function state(row: Record<string, unknown>, lastBackfill?: Record<string, unknown>) {
    mockSql
      .mockResolvedValueOnce([{ has_history: false, outdated: false, first_activity: "2024-02-06", latest_day: null, ...row }])
      .mockResolvedValueOnce(lastBackfill ? [lastBackfill] : []);
  }

  it("backfills from the first Strava activity when there's no history — even with recent rows present", async () => {
    state({ latest_day: "2026-10-25" });
    expect(await defaultSyncRange("user-1", TODAY)).toEqual({ start: "2024-02-06", end: TODAY, mode: "backfill" });
  });

  it("resumes an interrupted backfill after the last window it saved", async () => {
    state({ has_history: true, latest_day: "2025-03-01" }, { status: "interrupted", details: { completedThrough: "2025-03-01" } });
    expect(await defaultSyncRange("user-1", TODAY)).toEqual({ start: "2025-03-02", end: TODAY, mode: "backfill" });
  });

  it("re-reads only the last week once a backfill has finished and syncs are current", async () => {
    state({ has_history: true, latest_day: TODAY }, { status: "ok", details: {} });
    expect(await defaultSyncRange("user-1", TODAY)).toEqual({ start: "2026-10-20", end: TODAY, mode: "incremental" });
  });

  it("covers the whole gap after a stretch without syncing", async () => {
    state({ has_history: true, latest_day: "2026-09-30" }, { status: "ok", details: {} });
    expect(await defaultSyncRange("user-1", TODAY)).toEqual({ start: "2026-09-24", end: TODAY, mode: "incremental" });
  });

  it("trusts the old history check for databases from before sync_runs", async () => {
    state({ has_history: true, latest_day: "2026-10-25" });
    expect((await defaultSyncRange("user-1", TODAY)).mode).toBe("incremental");
  });

  it("backfills again when rows come from an older mapping version", async () => {
    state({ has_history: true, outdated: true, latest_day: "2026-10-25" });
    expect((await defaultSyncRange("user-1", TODAY)).mode).toBe("backfill");
  });
});
