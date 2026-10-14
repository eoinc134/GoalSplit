import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockAll, mockClose, mockPrepare, mockDatabaseCtor } = vi.hoisted(() => {
  const mockAll = vi.fn();
  const mockPrepare = vi.fn().mockReturnValue({ all: mockAll });
  const mockClose = vi.fn();
  // Must be a real `function`, not an arrow — it's invoked with `new`.
  const mockDatabaseCtor = vi.fn().mockImplementation(function MockDatabase() {
    return { prepare: mockPrepare, close: mockClose };
  });
  return { mockAll, mockClose, mockPrepare, mockDatabaseCtor };
});

vi.mock("better-sqlite3", () => ({ default: mockDatabaseCtor }));

vi.mock("../db/index.js", () => ({
  sql: Object.assign(vi.fn().mockResolvedValue([]), { json: vi.fn((v: unknown) => v) }),
  initSchema: vi.fn().mockResolvedValue(undefined),
}));

import { sql } from "../db/index.js";
import { importGarminDaysFromSqlite } from "./garmin-import.service.js";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;

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
});

describe("importGarminDaysFromSqlite", () => {
  it("reads daily_health_metrics from the SQLite file and upserts each row into Postgres", async () => {
    mockAll.mockReturnValue([makeRow(), makeRow({ metric_date: "2026-06-02" })]);

    const result = await importGarminDaysFromSqlite("./test-health.db", "user-1");

    expect(result.synced).toBe(2);
    expect(mockDatabaseCtor).toHaveBeenCalledWith("./test-health.db", { readonly: true });
    expect(mockClose).toHaveBeenCalled();
    // One upsert call per row.
    expect(mockSql).toHaveBeenCalledTimes(2);
  });

  it("returns zero synced when the SQLite file has no rows", async () => {
    const result = await importGarminDaysFromSqlite("./test-health.db", "user-1");
    expect(result.synced).toBe(0);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("closes the SQLite connection even if reading rows throws", async () => {
    mockPrepare.mockImplementationOnce(() => {
      throw new Error("corrupt db");
    });
    await expect(importGarminDaysFromSqlite("./test-health.db", "user-1")).rejects.toThrow("corrupt db");
    expect(mockClose).toHaveBeenCalled();
  });
});
