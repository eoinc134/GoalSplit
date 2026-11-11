import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

vi.mock("./db/index.js", () => ({
  sql: Object.assign(vi.fn(), { json: vi.fn((v: unknown) => v) }),
}));

import { readdirSync } from "node:fs";
import { sql } from "./db/index.js";
import { app } from "./app.js";
import { MIGRATIONS_DIR } from "./db/migrate.js";
import { resetLifecycleForTests, startDraining } from "./lib/lifecycle.js";
import { log, redactString, sanitise, setErrorReporter, withLogContext } from "./lib/logger.js";
import { resetHealthCacheForTests } from "./routes/health.js";
import { scrubEvent } from "./instrument.js";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;
const ALL_MIGRATIONS = readdirSync(MIGRATIONS_DIR).map((f) => ({ name: f.replace(/\.sql$/, "") }));

beforeEach(() => {
  vi.clearAllMocks();
  resetHealthCacheForTests();
  resetLifecycleForTests();
});
afterEach(() => {
  setErrorReporter(null);
  vi.unstubAllEnvs();
});

describe("redaction", () => {
  it("hides secret-named fields but keeps flags", () => {
    expect(
      sanitise({ accessToken: "abc", apiKey: "k", password: "p", nested: { authorization: "Bearer x" }, reauth_required: true, tokenCount: null }),
    ).toEqual({ accessToken: "[redacted]", apiKey: "[redacted]", password: "[redacted]", nested: { authorization: "[redacted]" }, reauth_required: true, tokenCount: null });
  });

  it("masks secrets inside strings", () => {
    expect(redactString("connect postgres://goalsplit:hunter2@db:5432/x failed")).toBe("connect postgres://goalsplit:[redacted]@db:5432/x failed");
    expect(redactString("sent Authorization: Bearer eyJhbGci.abc")).toBe("sent Authorization: Bearer [redacted]");
  });

  it("serialises errors with their code and cause chain", () => {
    const root = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
    const out = sanitise(new Error("fetch failed", { cause: root })) as Record<string, unknown>;
    expect(out).toMatchObject({ name: "Error", message: "fetch failed", cause: { message: "read ECONNRESET", code: "ECONNRESET" } });
    expect(out.stack).toContain("fetch failed");
  });
});

describe("structured output", () => {
  it("writes one JSON line per entry in production, stamped with service and version", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOG_LEVEL", "info");
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    withLogContext({ requestId: "req-1" }, () => log.info("sync finished", { event: "sync.finished", token: "t" }));
    const line = String(write.mock.calls[0][0]);
    write.mockRestore();

    expect(line.endsWith("\n")).toBe(true);
    expect(line.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(line)).toMatchObject({
      level: "info",
      message: "sync finished",
      event: "sync.finished",
      service: "api",
      version: "dev",
      requestId: "req-1",
      token: "[redacted]",
    });
  });
});

describe("error reporter hook", () => {
  it("receives error lines with the error and context — and nothing below error", () => {
    const reporter = vi.fn();
    setErrorReporter(reporter);
    const err = new Error("boom");
    withLogContext({ requestId: "req-9" }, () => {
      log.warn("just a warning");
      log.error("sync failed", { event: "sync.failed", err, apiKey: "secret" });
    });
    expect(reporter).toHaveBeenCalledTimes(1);
    const [message, fields, reported] = reporter.mock.calls[0];
    expect(message).toBe("sync failed");
    expect(reported).toBe(err);
    expect(fields).toMatchObject({ event: "sync.failed", requestId: "req-9", apiKey: "[redacted]" });
  });

  it("never lets a broken reporter break the caller", () => {
    setErrorReporter(() => {
      throw new Error("reporter down");
    });
    expect(() => log.error("something failed")).not.toThrow();
  });
});

describe("scrubEvent (Sentry beforeSend)", () => {
  it("strips cookies, auth headers, the API key, bodies and query strings", () => {
    const event = scrubEvent({
      type: undefined,
      request: {
        url: "https://api/x?code=abc",
        query_string: "code=abc",
        cookies: { gs_session: "s" },
        data: '{"code":"abc"}',
        headers: { Cookie: "a", Authorization: "Bearer x", "x-api-key": "k", "user-agent": "ua" },
      },
    });
    expect(event.request).toEqual({ url: "https://api/x", headers: { "user-agent": "ua" } });
  });
});

describe("health endpoints", () => {
  it("live answers without touching the database", async () => {
    const res = await request(app).get("/health/live");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", service: "api", version: "dev" });
    expect(mockSql).not.toHaveBeenCalled();
    expect((await request(app).get("/health")).status).toBe(200);
  });

  it("ready is 200 when the database answers and every migration is applied", async () => {
    mockSql.mockResolvedValueOnce(ALL_MIGRATIONS);
    const res = await request(app).get("/health/ready");
    expect(res.status).toBe(200);
    expect(res.body.checks).toMatchObject({ database: { ok: true }, migrations: { ok: true, pending: 0 } });
  });

  it("ready is 503 when a migration is pending", async () => {
    mockSql.mockResolvedValueOnce(ALL_MIGRATIONS.slice(0, -1));
    const res = await request(app).get("/health/ready");
    expect(res.status).toBe(503);
    expect(res.body.checks.migrations).toEqual({ ok: false, pending: 1 });
  });

  it("ready is 503 without leaking the database error when Postgres is unreachable", async () => {
    mockSql.mockRejectedValueOnce(new Error("connect ECONNREFUSED 10.0.0.5:5432 postgres://u:pw@db"));
    const res = await request(app).get("/health/ready");
    expect(res.status).toBe(503);
    expect(res.body.checks.database).toMatchObject({ ok: false, error: "unreachable" });
    expect(JSON.stringify(res.body)).not.toMatch(/10\.0\.0\.5|pw/);
  });

  it("caches the result briefly so probes can't flood the database", async () => {
    mockSql.mockResolvedValue(ALL_MIGRATIONS);
    await request(app).get("/health/ready");
    await request(app).get("/health/ready");
    expect(mockSql).toHaveBeenCalledTimes(1);
  });

  it("ready reports draining during shutdown", async () => {
    startDraining();
    const res = await request(app).get("/health/ready");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("draining");
  });

  it("sits outside the API key", async () => {
    vi.stubEnv("API_KEY", "k".repeat(40));
    expect((await request(app).get("/health/live")).status).toBe(200);
    expect((await request(app).get("/api/sync/status")).status).toBe(401);
  });
});

describe("request log", () => {
  it("records the route pattern and keeps health probes at debug level", async () => {
    vi.stubEnv("LOG_LEVEL", "debug");
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockSql.mockResolvedValue([]); // no user → 404 from /api/activities/:id
    await request(app).get("/api/activities/abc123");
    await request(app).get("/health/live");
    const lines = [...out.mock.calls, ...err.mock.calls].map(([l]) => String(l));
    out.mockRestore();
    err.mockRestore();

    const activity = lines.find((l) => l.includes("path=/api/activities/abc123"));
    expect(activity).toContain("route=/api/activities/:id");
    expect(activity).toContain("WARN"); // 404
    expect(lines.find((l) => l.includes("path=/health/live"))).toContain("DEBUG");
  });
});
