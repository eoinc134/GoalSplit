import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../db/index.js", () => ({
  sql: vi.fn(),
  initSchema: vi.fn().mockResolvedValue(undefined),
}));

import { app } from "../app.js";
import { sql } from "../db/index.js";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/training/load", () => {
  it("returns an insufficient-history summary when no user exists", async () => {
    mockSql.mockResolvedValueOnce([]); // users
    const res = await request(app).get("/api/training/load");
    expect(res.status).toBe(200);
    expect(res.body.data.acwr).toBeNull();
    expect(res.body.data.insufficientHistory).toBe(true);
  });

  it("builds a load summary from activities and their list-dump suffer_score", async () => {
    mockSql
      .mockResolvedValueOnce([{ id: "user-1" }]) // users
      .mockResolvedValueOnce([{ today: "2026-09-08", first_date: "2026-08-01" }]) // bounds
      .mockResolvedValueOnce([{ id: "act-1", local_date: "2026-09-08" }]) // activities in window
      .mockResolvedValueOnce([{ activity_id: "act-1", payload: { suffer_score: 60 } }]); // list dumps

    const res = await request(app).get("/api/training/load");

    expect(res.status).toBe(200);
    expect(res.body.data.asOf).toBe("2026-09-08");
    expect(res.body.data.daily).toHaveLength(28);
    expect(res.body.data.insufficientHistory).toBe(false);
    expect(res.body.data.acute.totalLoad).toBe(60);
  });

  it("skips the dump lookup entirely when there are no activities in the window", async () => {
    mockSql
      .mockResolvedValueOnce([{ id: "user-1" }]) // users
      .mockResolvedValueOnce([{ today: "2026-09-08", first_date: null }]) // bounds
      .mockResolvedValueOnce([]); // activities in window

    const res = await request(app).get("/api/training/load");

    expect(res.status).toBe(200);
    expect(mockSql).toHaveBeenCalledTimes(3);
    expect(res.body.data.insufficientHistory).toBe(true);
  });
});

describe("GET /api/training/trends", () => {
  it("returns empty series when no user exists", async () => {
    mockSql.mockResolvedValueOnce([]); // users
    const res = await request(app).get("/api/training/trends");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ weeks: 12, volumeByType: [], runPace: [] });
  });

  it("returns weekly volume-by-type and run-pace series, flagging the current week", async () => {
    mockSql
      .mockResolvedValueOnce([{ id: "user-1" }]) // users
      .mockResolvedValueOnce([{ week_start: "2026-09-07" }]) // current week start
      .mockResolvedValueOnce([
        { week_start: "2026-08-31", type: "Run", activity_count: 3, distance_m: 15000, moving_time_s: 5400 },
        { week_start: "2026-09-07", type: "Run", activity_count: 1, distance_m: 5000, moving_time_s: 1800 },
      ])
      .mockResolvedValueOnce([
        { week_start: "2026-08-31", distance_m: 15000, moving_time_s: 5400 },
        { week_start: "2026-09-07", distance_m: 5000, moving_time_s: 1800 },
      ]);

    const res = await request(app).get("/api/training/trends?weeks=8");

    expect(res.status).toBe(200);
    expect(res.body.data.weeks).toBe(8);
    expect(res.body.data.volumeByType).toHaveLength(2);
    expect(res.body.data.volumeByType[0].isPartialWeek).toBe(false);
    expect(res.body.data.volumeByType[1].isPartialWeek).toBe(true);
    expect(res.body.data.runPace[1].isPartialWeek).toBe(true);
  });

  it("clamps weeks to the 1-52 range", async () => {
    mockSql.mockResolvedValueOnce([]); // users
    const res = await request(app).get("/api/training/trends?weeks=9999");
    expect(res.body.data.weeks).toBe(52);
  });
});
