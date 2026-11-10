import { describe, it, expect, vi, afterEach } from "vitest";
import { authDisabled, createSessionValue, randomState, verifySessionValue } from "./session";

const SECRET = "s".repeat(48);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("session cookie", () => {
  it("verifies a value it signed", async () => {
    expect(await verifySessionValue(await createSessionValue(123, SECRET), SECRET)).toBe(true);
  });

  it("rejects a different secret, a tampered athlete id, and junk", async () => {
    const value = await createSessionValue(123, SECRET);
    expect(await verifySessionValue(value, "other-secret")).toBe(false);
    expect(await verifySessionValue(value.replace(/^123/, "124"), SECRET)).toBe(false);
    expect(await verifySessionValue("nonsense", SECRET)).toBe(false);
    expect(await verifySessionValue(undefined, SECRET)).toBe(false);
  });

  it("expires after 30 days", async () => {
    const value = await createSessionValue(123, SECRET);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31 * 24 * 60 * 60 * 1000);
    expect(await verifySessionValue(value, SECRET)).toBe(false);
  });
});

describe("authDisabled", () => {
  it("is only true outside production with no secret", () => {
    vi.stubEnv("SESSION_SECRET", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(authDisabled()).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(authDisabled()).toBe(false);
    vi.stubEnv("SESSION_SECRET", SECRET);
    vi.stubEnv("NODE_ENV", "development");
    expect(authDisabled()).toBe(false);
  });
});

it("randomState is 64 hex chars and unique", () => {
  const a = randomState();
  expect(a).toMatch(/^[0-9a-f]{64}$/);
  expect(randomState()).not.toBe(a);
});
