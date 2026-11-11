import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  withScope: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import { api, ApiError, errorMessage } from "./api";
import { failures, load, loadList } from "./server-api";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser api client", () => {
  it("unwraps { data } so callers get the payload itself", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(201, { data: { id: "pr-1", distanceLabel: "5K" } })));
    expect(await api.post("/prs", { distanceLabel: "5K" })).toEqual({ id: "pr-1", distanceLabel: "5K" });
  });

  it("returns nothing for 204", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(api.delete("/prs/1")).resolves.toBeUndefined();
  });

  it("turns error bodies into ApiError with the server's message and code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json(409, { error: "A Strava sync is already running", code: "SYNC_IN_PROGRESS", statusCode: 409 })),
    );
    const err = await api.post("/activities/sync").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: "SYNC_IN_PROGRESS", message: "A Strava sync is already running" });
  });

  it("gives a readable error when the network is down", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const err = await api.get("/x").catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 0, code: "NETWORK_ERROR" });
    expect(errorMessage(err)).toMatch(/can't reach/i);
  });

  it("rejects a success response that isn't the envelope", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, [1, 2, 3])));
    await expect(api.get("/x")).rejects.toMatchObject({ code: "UNEXPECTED_RESPONSE" });
  });

  it("sends the user to sign in only when its own session expired", async () => {
    const location = { href: "/training" };
    vi.stubGlobal("window", { location });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(401, { error: "Strava access was revoked", code: "STRAVA_REAUTH_REQUIRED", statusCode: 401 })));
    await api.post("/activities/sync").catch(() => undefined);
    expect(location.href).toBe("/training");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(401, { error: "Not signed in", code: "SESSION_REQUIRED", statusCode: 401 })));
    await api.get("/x").catch(() => undefined);
    expect(location.href).toBe("/login");
  });
});

describe("server load()", () => {
  it("returns the data and no error on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { data: { totalRuns: 4 } })));
    expect(await load("/dashboard/stats", { totalRuns: 0 })).toEqual({ data: { totalRuns: 4 }, error: null });
  });

  it("returns the fallback plus the API's message when it fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(503, { error: "Stream metrics still computing", code: "METRICS_PENDING", statusCode: 503 })));
    const r = await load("/training/load", { ctl: 0 });
    expect(r.data).toEqual({ ctl: 0 });
    expect(r.error).toEqual({ path: "/training/load", status: 503, message: "Stream metrics still computing" });
  });

  it("marks an unreachable API with status 0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const r = await load("/prs", []);
    expect(r.error).toMatchObject({ status: 0, message: "The GoalSplit API is unreachable" });
  });

  it("loadList keeps the total, and failures() collects only the failed loads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { data: [{ id: "a" }], total: 37 })));
    const ok = await loadList<{ id: string }>("/activities");
    expect(ok.data).toEqual({ rows: [{ id: "a" }], total: 37 });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(500, { error: "boom", code: "INTERNAL_ERROR", statusCode: 500 })));
    const bad = await loadList("/activities");
    expect(bad.data).toEqual({ rows: [], total: 0 });
    expect(failures(ok, bad)).toEqual([bad.error]);
  });
});
