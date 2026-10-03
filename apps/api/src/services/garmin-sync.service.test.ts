import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockExecFile, mockAll, mockClose, mockPrepare, mockDatabaseCtor } = vi.hoisted(() => {
  const mockAll = vi.fn();
  const mockPrepare = vi.fn().mockReturnValue({ all: mockAll });
  const mockClose = vi.fn();
  // Must be a real `function`, not an arrow — it's invoked with `new`.
  const mockDatabaseCtor = vi.fn().mockImplementation(function MockDatabase() {
    return { prepare: mockPrepare, close: mockClose };
  });
  const mockExecFile = vi.fn(
    (
      _file: string,
      _args: string[],
      _options: unknown,
      callback: (err: Error | null, stdout?: string, stderr?: string) => void,
    ) => callback(null, "", ""),
  );
  return { mockExecFile, mockAll, mockClose, mockPrepare, mockDatabaseCtor };
});

vi.mock("node:child_process", () => ({ execFile: mockExecFile }));
vi.mock("better-sqlite3", () => ({ default: mockDatabaseCtor }));

vi.mock("../db/index.js", () => ({
  sql: Object.assign(vi.fn().mockResolvedValue([]), { json: vi.fn((v: unknown) => v) }),
  initSchema: vi.fn().mockResolvedValue(undefined),
}));

import { sql } from "../db/index.js";
import { syncGarminDays } from "./garmin-sync.service.js";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;

const ENV_KEYS = ["GARMIN_EMAIL", "GARMIN_PASSWORD", "GARMY_DB_PATH"] as const;
const originalEnv: Record<string, string | undefined> = {};

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    metric_date: "2026-06-01",
    resting_heart_rate: 52,
    max_heart_rate: 178,
    min_heart_rate: 48,
    average_heart_rate: 68,
    avg_stress_level: 24,
    max_stress_level: 61,
    body_battery_high: 95,
    body_battery_low: 18,
    sleep_duration_hours: 7.5,
    training_readiness_score: 72,
    training_readiness_level: "Moderate",
    hrv_last_night_avg: 45.2,
    hrv_status: "Balanced",
    total_steps: 8421,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSql.mockResolvedValue([]);
  mockAll.mockReturnValue([]);
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.GARMIN_EMAIL = "me@example.com";
  process.env.GARMIN_PASSWORD = "secret";
  process.env.GARMY_DB_PATH = "./test-health.db";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("syncGarminDays", () => {
  it("throws GARMIN_NOT_CONFIGURED when env vars are missing", async () => {
    delete process.env.GARMIN_EMAIL;
    await expect(syncGarminDays("user-1", 7)).rejects.toThrow("GARMIN_NOT_CONFIGURED");
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("surfaces a clear error when the garmy-sync CLI fails", async () => {
    mockExecFile.mockImplementationOnce((_file, _args, _options, callback) => callback(new Error("spawn ENOENT")));
    await expect(syncGarminDays("user-1", 7)).rejects.toThrow("GARMIN_SYNC_FAILED");
  });

  it("invokes garmy via `python3 -m garmy.localdb.cli`, not the garmy-sync console script", async () => {
    await syncGarminDays("user-1", 7);
    const [file, args, options] = mockExecFile.mock.calls[0];
    expect(file).toBe("python3");
    expect(args).toEqual(["-m", "garmy.localdb.cli", "sync", "--last-days", "7"]);
    expect((options as { env: Record<string, string> }).env).toMatchObject({
      GARMIN_EMAIL: "me@example.com",
      GARMIN_PASSWORD: "secret",
      GARMY_DB_PATH: "./test-health.db",
    });
  });

  it("reads daily_health_metrics from the SQLite file and upserts each row into Postgres", async () => {
    mockAll.mockReturnValue([makeRow(), makeRow({ metric_date: "2026-06-02" })]);

    const result = await syncGarminDays("user-1", 7);

    expect(result.synced).toBe(2);
    expect(mockDatabaseCtor).toHaveBeenCalledWith("./test-health.db", { readonly: true });
    expect(mockClose).toHaveBeenCalled();
    // One upsert call per row.
    expect(mockSql).toHaveBeenCalledTimes(2);
  });

  it("returns zero synced when the SQLite file has no rows in range", async () => {
    mockAll.mockReturnValue([]);
    const result = await syncGarminDays("user-1", 7);
    expect(result.synced).toBe(0);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("closes the SQLite connection even if reading rows throws", async () => {
    mockPrepare.mockImplementationOnce(() => {
      throw new Error("corrupt db");
    });
    await expect(syncGarminDays("user-1", 7)).rejects.toThrow("corrupt db");
    expect(mockClose).toHaveBeenCalled();
  });
});
