import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

vi.mock("./db/index.js", () => ({
  sql: Object.assign(vi.fn().mockResolvedValue([]), { json: vi.fn((v: unknown) => v) }),
}));

import { sql } from "./db/index.js";
import { app } from "./app.js";
import { fetchWithRetry, HttpTimeoutError } from "./lib/http.js";
import { parseRateInfo } from "./lib/strava-client.js";
import {
  markInterruptedRuns,
  SyncInProgressError,
  trackSyncRun,
  type RunOutcome,
} from "./services/sync-runs.service.js";
import { runScheduledSync, scheduleIntervalMinutes } from "./services/scheduler.js";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;
const statements = () => mockSql.mock.calls.map(([s]) => (Array.isArray(s) ? s.join("?") : ""));

beforeEach(() => {
  vi.clearAllMocks();
  mockSql.mockResolvedValue([]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("fetchWithRetry", () => {
  const fast = { label: "test", backoffMs: [0] };

  it("retries 5xx and returns the eventual success", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await fetchWithRetry("https://x", {}, fast);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never retries 4xx — a 429 or 401 won't change", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await fetchWithRetry("https://x", {}, fast)).status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns the last 5xx once retries run out", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(null, { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await fetchWithRetry("https://x", {}, { ...fast, retries: 2 })).status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("turns a stalled request into a timeout error after retries", async () => {
    const timeout = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeout));
    await expect(fetchWithRetry("https://x", {}, { ...fast, retries: 1 })).rejects.toBeInstanceOf(HttpTimeoutError);
  });

  it("honours retries: 0 for single-use requests", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchWithRetry("https://x", {}, { ...fast, retries: 0 })).rejects.toThrow("fetch failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("parseRateInfo", () => {
  it("steers by the stricter read bucket", () => {
    const info = parseRateInfo(new Headers({
      "X-RateLimit-Limit": "200,2000",
      "X-RateLimit-Usage": "90,300",
      "X-ReadRateLimit-Limit": "100,1000",
      "X-ReadRateLimit-Usage": "90,300",
    }));
    expect(info.fraction).toBeCloseTo(0.9);
    expect(info.window).toBe("fifteenMin");
    expect(info.fifteenMin).toEqual({ used: 90, limit: 100 });
  });

  it("notices when the daily window is the one running out", () => {
    const info = parseRateInfo(new Headers({ "X-ReadRateLimit-Limit": "100,1000", "X-ReadRateLimit-Usage": "5,950" }));
    expect(info.window).toBe("daily");
    expect(info.fraction).toBeCloseTo(0.95);
  });

  it("ignores missing and -1 limits instead of reading them as zero quota", () => {
    expect(parseRateInfo(new Headers()).fraction).toBe(0);
    expect(parseRateInfo(new Headers({ "X-RateLimit-Limit": "-1,-1", "X-RateLimit-Usage": "-1,-1" })).fraction).toBe(0);
  });
});

describe("trackSyncRun", () => {
  const opts = { userId: "u1", source: "strava" as const, mode: "incremental", trigger: "manual" as const };

  it("records a running row, then the outcome", async () => {
    const result = await trackSyncRun(opts, async () => ({ result: 42, status: "partial", items: 3 }));
    expect(result).toBe(42);
    const q = statements();
    expect(q[0]).toContain("INSERT INTO sync_runs");
    expect(q.at(-1)).toContain("UPDATE sync_runs SET");
    expect(mockSql.mock.calls.at(-1)).toContain("partial");
  });

  it("records failures with their message and rethrows", async () => {
    await expect(trackSyncRun(opts, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    const failed = mockSql.mock.calls.find(([s]) => s.join("?").includes("status = 'failed'"));
    expect(failed).toContain("boom");
  });

  it("allows one sync per source at a time", async () => {
    let release!: () => void;
    const first = trackSyncRun(
      opts,
      () => new Promise<RunOutcome<number>>((r) => (release = () => r({ result: 1, status: "ok", items: 0 }))),
    );
    await vi.waitFor(() => expect(release).toBeDefined());
    await expect(trackSyncRun(opts, async () => ({ result: 2, status: "ok", items: 0 }))).rejects.toBeInstanceOf(SyncInProgressError);
    // A different source isn't blocked.
    await expect(trackSyncRun({ ...opts, source: "garmin" }, async () => ({ result: 3, status: "ok", items: 0 }))).resolves.toBe(3);
    release();
    await first;
    // …and the lock is released afterwards, even after a failure.
    await expect(trackSyncRun(opts, async () => { throw new Error("x"); })).rejects.toThrow("x");
    await expect(trackSyncRun(opts, async () => ({ result: 4, status: "ok", items: 0 }))).resolves.toBe(4);
  });

  it("marks runs a dead process left 'running' as interrupted", async () => {
    mockSql.mockResolvedValueOnce([{ id: "a" }, { id: "b" }]);
    expect(await markInterruptedRuns()).toBe(2);
    expect(statements()[0]).toContain("status = 'interrupted'");
  });
});

describe("scheduler", () => {
  it("defaults to 6 hours, and 0 disables it", () => {
    expect(scheduleIntervalMinutes()).toBe(360);
    vi.stubEnv("SYNC_INTERVAL_MINUTES", "0");
    expect(scheduleIntervalMinutes()).toBe(0);
    vi.stubEnv("SYNC_INTERVAL_MINUTES", "nonsense");
    expect(scheduleIntervalMinutes()).toBe(360);
  });

  it("doesn't spend requests on a token Strava has already rejected", async () => {
    mockSql
      .mockResolvedValueOnce([{ id: "u1" }]) // current user
      .mockResolvedValueOnce([{ user_id: "u1", access_token: "a", refresh_token: "r", expires_at: 0, reauth_required_at: "2026-11-01" }]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await runScheduledSync();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(statements().some((q) => q.includes("INSERT INTO sync_runs"))).toBe(false);
  });
});

describe("request log", () => {
  it("tags every response with a request id, reusing a valid incoming one", async () => {
    const fresh = await request(app).get("/health");
    expect(fresh.headers["x-request-id"]).toMatch(/^[0-9a-f]{16}$/);
    const passed = await request(app).get("/health").set("x-request-id", "web-abc12345");
    expect(passed.headers["x-request-id"]).toBe("web-abc12345");
    const bogus = await request(app).get("/health").set("x-request-id", "bad id <script>");
    expect(bogus.headers["x-request-id"]).not.toContain("bad");
  });
});
