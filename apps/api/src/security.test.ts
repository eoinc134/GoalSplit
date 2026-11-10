import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

vi.mock("./db/index.js", () => ({
  sql: vi.fn(),
  initSchema: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./lib/strava-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/strava-client.js")>()),
  exchangeCode: vi.fn(),
  refreshToken: vi.fn(),
}));

import { app } from "./app.js";
import { sql } from "./db/index.js";
import { exchangeCode, refreshToken, StravaAuthError } from "./lib/strava-client.js";
import { decryptToken, encryptToken, isEncrypted } from "./lib/token-crypto.js";
import { assertSecurityConfig } from "./lib/security-config.js";
import { getValidAccessToken, STRAVA_REAUTH_REQUIRED } from "./services/token.service.js";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;
const mockExchange = exchangeCode as unknown as ReturnType<typeof vi.fn>;
const mockRefresh = refreshToken as unknown as ReturnType<typeof vi.fn>;

const KEY = "k".repeat(40);
const ENC_KEY = "ab".repeat(32);

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
afterEach(() => vi.unstubAllEnvs());

describe("API key", () => {
  it("rejects /api requests without the key when API_KEY is set", async () => {
    vi.stubEnv("API_KEY", KEY);
    const res = await request(app).get("/api/auth/status");
    expect(res.status).toBe(401);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("rejects a wrong key", async () => {
    vi.stubEnv("API_KEY", KEY);
    const res = await request(app).get("/api/auth/status").set("x-api-key", "nope");
    expect(res.status).toBe(401);
  });

  it("accepts the key via x-api-key or a Bearer header", async () => {
    vi.stubEnv("API_KEY", KEY);
    mockSql.mockResolvedValue([]);
    expect((await request(app).get("/api/auth/status").set("x-api-key", KEY)).status).toBe(200);
    expect((await request(app).get("/api/auth/status").set("authorization", `Bearer ${KEY}`)).status).toBe(200);
  });

  it("leaves /health open", async () => {
    vi.stubEnv("API_KEY", KEY);
    expect((await request(app).get("/health")).status).toBe(200);
  });

  it("returns JSON 404 for unknown routes and sends no CORS headers", async () => {
    const res = await request(app).get("/api/nope").set("origin", "https://evil.example");
    expect(res.status).toBe(404);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("startup config", () => {
  it("refuses to start in production without the required secrets", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("API_KEY", "");
    expect(() => assertSecurityConfig()).toThrow(/API_KEY/);
  });

  it("starts in production with everything set", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("API_KEY", KEY);
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", ENC_KEY);
    vi.stubEnv("ALLOWED_STRAVA_ATHLETE_ID", "123");
    expect(() => assertSecurityConfig()).not.toThrow();
  });

  it("rejects a short API key", () => {
    vi.stubEnv("API_KEY", "short");
    expect(() => assertSecurityConfig()).toThrow(/32 characters/);
  });
});

describe("Strava OAuth", () => {
  const athlete = { id: 123, firstname: "A", lastname: "B", username: "ab", profile: null, sex: "M" };
  const tokens = { access_token: "acc", refresh_token: "ref", expires_at: 9_999_999_999, athlete };

  it("puts the caller's state into the authorize URL", async () => {
    const res = await request(app).get("/api/auth/strava/authorize-url?state=0123456789abcdef");
    expect(res.status).toBe(200);
    expect(new URL(res.body.data.url).searchParams.get("state")).toBe("0123456789abcdef");
  });

  it("requires a state value", async () => {
    expect((await request(app).get("/api/auth/strava/authorize-url")).status).toBe(400);
  });

  it("rejects an athlete other than ALLOWED_STRAVA_ATHLETE_ID without storing anything", async () => {
    vi.stubEnv("ALLOWED_STRAVA_ATHLETE_ID", "999");
    mockExchange.mockResolvedValueOnce(tokens);
    const res = await request(app).post("/api/auth/strava/exchange").send({ code: "c" });
    expect(res.status).toBe(403);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("without an allowlist, rejects a second athlete once someone owns the app", async () => {
    mockExchange.mockResolvedValueOnce(tokens);
    mockSql.mockResolvedValueOnce([{ strava_athlete_id: "555" }]);
    const res = await request(app).post("/api/auth/strava/exchange").send({ code: "c" });
    expect(res.status).toBe(403);
    expect(mockSql).toHaveBeenCalledTimes(1);
  });

  it("stores the allowed athlete's tokens encrypted", async () => {
    vi.stubEnv("ALLOWED_STRAVA_ATHLETE_ID", "123");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", ENC_KEY);
    mockExchange.mockResolvedValueOnce(tokens);
    mockSql.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "u1" }]).mockResolvedValueOnce([]);

    const res = await request(app).post("/api/auth/strava/exchange").send({ code: "c" });

    expect(res.status).toBe(200);
    const saveCallValues = mockSql.mock.calls[2].slice(1) as unknown[];
    expect(saveCallValues).not.toContain("acc");
    expect(saveCallValues).not.toContain("ref");
    expect(isEncrypted(saveCallValues[1] as string)).toBe(true);
  });

  it("doesn't leak Strava's error body when the exchange fails", async () => {
    mockExchange.mockRejectedValueOnce(new StravaAuthError("Token exchange failed", 400));
    const res = await request(app).post("/api/auth/strava/exchange").send({ code: "c" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("token_exchange_failed");
  });
});

describe("token encryption", () => {
  it("round-trips and uses a fresh IV each time", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", ENC_KEY);
    const a = encryptToken("secret");
    const b = encryptToken("secret");
    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe("secret");
  });

  it("reads legacy plaintext values as-is", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", ENC_KEY);
    expect(decryptToken("plain-token")).toBe("plain-token");
  });

  it("detects tampering", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", ENC_KEY);
    const enc = encryptToken("secret");
    const tampered = enc.slice(0, -4) + (enc.endsWith("AAAA") ? "BBBB" : "AAAA");
    expect(() => decryptToken(tampered)).toThrow();
  });
});

describe("token refresh", () => {
  const expired = { user_id: "u1", access_token: "old", refresh_token: "r", expires_at: 0 };

  it("shares one Strava refresh between concurrent callers", async () => {
    mockSql.mockResolvedValueOnce([expired]).mockResolvedValueOnce([expired]).mockResolvedValue([]);
    let resolve!: (v: unknown) => void;
    mockRefresh.mockReturnValueOnce(new Promise((r) => (resolve = r)));

    const first = getValidAccessToken("u1");
    const second = getValidAccessToken("u1");
    await vi.waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    resolve({ access_token: "new", refresh_token: "r2", expires_at: 9_999_999_999 });

    expect(await Promise.all([first, second])).toEqual(["new", "new"]);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("asks for reconnection when Strava rejects the refresh token", async () => {
    mockSql.mockResolvedValueOnce([expired]);
    mockRefresh.mockRejectedValueOnce(new StravaAuthError("Token refresh failed", 400));
    await expect(getValidAccessToken("u1")).rejects.toThrow(STRAVA_REAUTH_REQUIRED);
  });
});
