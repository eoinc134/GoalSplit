import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../db/index.js", () => ({
  sql: vi.fn(),
  initSchema: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/sync.service.js", () => ({
  syncActivities: vi.fn(),
}));

import { app } from "../app.js";
import { sql } from "../db/index.js";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;

function makeActivityRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "act-1",
    strava_id: 1,
    name: "Morning Run",
    type: "Run",
    sport_type: "Run",
    distance: 10000,
    moving_time: 2400,
    elapsed_time: 2450,
    total_elevation_gain: 50,
    average_speed: 4.17,
    max_speed: 5,
    average_heartrate: 150,
    max_heartrate: 170,
    start_date: "2025-06-01T08:00:00Z",
    start_date_local: "2025-06-01T09:00:00Z",
    timezone: "Europe/Dublin",
    synced_at: "2025-06-01T09:05:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/activities/export", () => {
  it("returns empty summary when no user exists", async () => {
    mockSql.mockResolvedValueOnce([]);
    const res = await request(app).get("/api/activities/export");
    expect(res.status).toBe(200);
    expect(res.body.data.activities).toEqual([]);
    expect(res.body.data.summary.activityCount).toBe(0);
  });

  it("returns activities and a markdown summary as JSON by default", async () => {
    mockSql
      .mockResolvedValueOnce([{ id: "user-1" }])
      .mockResolvedValueOnce([makeActivityRow()])
      .mockResolvedValueOnce([]); // dumps

    const res = await request(app).get("/api/activities/export?days=7");
    expect(res.status).toBe(200);
    expect(res.body.data.summary).toMatchObject({
      windowDays: 7,
      activityCount: 1,
      totalDistanceKm: 10,
    });
    expect(res.body.data.markdown).toContain("Training log — last 7 days");
    expect(res.body.data.activities).toHaveLength(1);
  });

  it("returns a markdown file when format=markdown", async () => {
    mockSql
      .mockResolvedValueOnce([{ id: "user-1" }])
      .mockResolvedValueOnce([makeActivityRow()])
      .mockResolvedValueOnce([]); // dumps

    const res = await request(app).get("/api/activities/export?format=markdown");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/markdown");
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.text).toContain("Training log");
  });

  it("enriches the markdown notes section from raw dump payloads", async () => {
    mockSql
      .mockResolvedValueOnce([{ id: "user-1" }])
      .mockResolvedValueOnce([makeActivityRow()])
      .mockResolvedValueOnce([
        {
          activity_id: "act-1",
          source: "list",
          payload: { workout_type: 1, suffer_score: 87, average_cadence: 86 },
        },
        {
          activity_id: "act-1",
          source: "detail",
          payload: {
            description: "Felt strong",
            splits_metric: [{ average_speed: 4.2 }, { average_speed: 4.0 }],
            best_efforts: [{ name: "5K", elapsed_time: 1198 }],
          },
        },
      ]);

    const res = await request(app).get("/api/activities/export");
    expect(res.status).toBe(200);
    expect(res.body.data.summary.totalEffort).toBe(87);
    expect(res.body.data.markdown).toContain("race, effort 87, cadence 172spm");
    expect(res.body.data.markdown).toContain('"Felt strong"');
    expect(res.body.data.markdown).toContain("Splits:");
    expect(res.body.data.markdown).toContain("Best effort: 5K in 19:58");
  });

  it("clamps days to the 1-365 range", async () => {
    mockSql.mockResolvedValueOnce([]);
    const res = await request(app).get("/api/activities/export?days=9999");
    expect(res.body.data.summary.windowDays).toBe(365);
  });
});

describe("GET /api/activities/:id", () => {
  const validPolyline = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";

  it("returns 404 when no user exists", async () => {
    mockSql.mockResolvedValueOnce([]); // users
    const res = await request(app).get("/api/activities/act-1");
    expect(res.status).toBe(404);
  });

  it("returns 404 when the activity doesn't exist or isn't the user's", async () => {
    mockSql
      .mockResolvedValueOnce([{ id: "user-1" }]) // users
      .mockResolvedValueOnce([]); // activity lookup — not found

    const res = await request(app).get("/api/activities/not-mine");

    expect(res.status).toBe(404);
  });

  it("returns the activity with a null route and null notes when there are no dumps", async () => {
    mockSql
      .mockResolvedValueOnce([{ id: "user-1" }]) // users
      .mockResolvedValueOnce([makeActivityRow()]) // activity lookup
      .mockResolvedValueOnce([]); // dumps

    const res = await request(app).get("/api/activities/act-1");

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe("act-1");
    expect(res.body.data.route).toBeNull();
    expect(res.body.data.notes).toBeNull();
  });

  it("decodes the route from the list dump's summary_polyline", async () => {
    mockSql
      .mockResolvedValueOnce([{ id: "user-1" }]) // users
      .mockResolvedValueOnce([makeActivityRow()]) // activity lookup
      .mockResolvedValueOnce([
        { activity_id: "act-1", source: "list", payload: { map: { summary_polyline: validPolyline } } },
      ]); // dumps

    const res = await request(app).get("/api/activities/act-1");

    expect(res.status).toBe(200);
    expect(res.body.data.route).toHaveLength(3);
  });

  it("builds the notes block from list+detail dumps, reusing the export's formatting", async () => {
    mockSql
      .mockResolvedValueOnce([{ id: "user-1" }]) // users
      .mockResolvedValueOnce([makeActivityRow()]) // activity lookup
      .mockResolvedValueOnce([
        { activity_id: "act-1", source: "list", payload: { workout_type: 1, suffer_score: 87 } },
        { activity_id: "act-1", source: "detail", payload: { description: "Felt strong" } },
      ]); // dumps

    const res = await request(app).get("/api/activities/act-1");

    expect(res.status).toBe(200);
    expect(res.body.data.notes).toContain("race, effort 87");
    expect(res.body.data.notes).toContain('"Felt strong"');
  });
});
