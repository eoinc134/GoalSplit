import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@sentry/nextjs", () => {
  const scope = { setTag: vi.fn(), setContext: vi.fn() };
  return {
    withScope: vi.fn((fn: (s: typeof scope) => void) => fn(scope)),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
    __scope: scope,
  };
});

import * as Sentry from "@sentry/nextjs";
import { log } from "./log";
import { scrubEvent } from "./sentry-options";
import { GET as health } from "@/app/api/health/route";
import { GET as live } from "@/app/api/health/live/route";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("web logger", () => {
  it("reports error lines to Sentry with the request id and redacted fields", () => {
    const err = new Error("proxy down");
    log.error("API proxy request failed", { event: "proxy.failed", requestId: "web-123", err, state: "secret-state" });
    expect(Sentry.captureException).toHaveBeenCalledWith(err);
    const scope = (Sentry as unknown as { __scope: { setTag: ReturnType<typeof vi.fn>; setContext: ReturnType<typeof vi.fn> } }).__scope;
    expect(scope.setTag).toHaveBeenCalledWith("requestId", "web-123");
    expect(scope.setContext.mock.calls[0][1]).toMatchObject({ state: "[redacted]" });
  });

  it("doesn't report below error level", () => {
    log.warn("api health check failed");
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });
});

describe("scrubEvent", () => {
  it("drops the OAuth callback's code and state from the URL, and cookies", () => {
    const event = scrubEvent({
      type: undefined,
      request: { url: "https://web/api/auth/strava/callback?code=abc&state=xyz", cookies: { gs_session: "s" }, headers: { cookie: "c", "user-agent": "ua" } },
    });
    expect(event.request).toEqual({ url: "https://web/api/auth/strava/callback", headers: { "user-agent": "ua" } });
  });
});

describe("health routes", () => {
  it("live answers on its own", async () => {
    const res = live();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", service: "web" });
  });

  it("is ok when the API is ready", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await health();
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:3001/health/ready");
  });

  it("is degraded (503) when the API isn't ready or can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 503 })));
    expect((await health()).status).toBe(503);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const res = await health();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "degraded", checks: { api: { ok: false } } });
  });
});
