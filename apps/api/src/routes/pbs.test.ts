import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../db/index.js", () => ({
  sql: vi.fn(),
  initSchema: vi.fn().mockResolvedValue(undefined),
}));

import { app } from "../app.js";
import { sql } from "../db/index.js";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;

function makePbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "pb-1",
    distance: 5,
    distance_label: "5K",
    time: 1200,
    pace: 240,
    goal_time: null,
    goal_pace: null,
    date: "2024-06-01",
    run_id: null,
    notes: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/pbs", () => {
  it("returns empty array when no PBs exist", async () => {
    mockSql.mockResolvedValue([]);
    const res = await request(app).get("/api/pbs");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [] });
  });

  it("returns mapped PBs with camelCase fields", async () => {
    mockSql.mockResolvedValue([makePbRow()]);
    const res = await request(app).get("/api/pbs");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      id: "pb-1",
      distanceLabel: "5K",
      time: 1200,
      pace: 240,
    });
  });

  it("maps null goalTime to undefined (omitted from JSON)", async () => {
    mockSql.mockResolvedValue([makePbRow({ goal_time: null })]);
    const res = await request(app).get("/api/pbs");
    expect(res.body.data[0].goalTime).toBeUndefined();
  });

  it("includes goalTime when set", async () => {
    mockSql.mockResolvedValue([makePbRow({ goal_time: 1140, goal_pace: 228 })]);
    const res = await request(app).get("/api/pbs");
    expect(res.body.data[0].goalTime).toBe(1140);
    expect(res.body.data[0].goalPace).toBe(228);
  });
});

describe("POST /api/pbs", () => {
  it("creates a PB and returns 201", async () => {
    mockSql.mockResolvedValue([makePbRow()]);
    const res = await request(app)
      .post("/api/pbs")
      .send({ distance: 5, distanceLabel: "5K", time: 1200, pace: 240, date: "2024-06-01" });
    expect(res.status).toBe(201);
    expect(res.body.data.distanceLabel).toBe("5K");
  });

  it("returns the created PB with mapped fields", async () => {
    mockSql.mockResolvedValue([makePbRow({ goal_time: 1140 })]);
    const res = await request(app)
      .post("/api/pbs")
      .send({ distance: 5, distanceLabel: "5K", time: 1200, pace: 240, goalTime: 1140, date: "2024-06-01" });
    expect(res.body.data.goalTime).toBe(1140);
  });
});

describe("PATCH /api/pbs/:id", () => {
  it("returns 404 when PB not found", async () => {
    mockSql.mockResolvedValue([]);
    const res = await request(app).patch("/api/pbs/none").send({ time: 1100 });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "PB not found", statusCode: 404 });
  });

  it("returns updated PB on success", async () => {
    mockSql.mockResolvedValue([makePbRow({ time: 1100, pace: 220 })]);
    const res = await request(app).patch("/api/pbs/pb-1").send({ time: 1100, pace: 220 });
    expect(res.status).toBe(200);
    expect(res.body.data.time).toBe(1100);
    expect(res.body.data.pace).toBe(220);
  });

  it("can set a goal time", async () => {
    mockSql.mockResolvedValue([makePbRow({ goal_time: 1140, goal_pace: 228 })]);
    const res = await request(app).patch("/api/pbs/pb-1").send({ goalTime: 1140, goalPace: 228 });
    expect(res.body.data.goalTime).toBe(1140);
  });
});

describe("DELETE /api/pbs/:id", () => {
  it("returns 404 when PB not found", async () => {
    mockSql.mockResolvedValue([]);
    const res = await request(app).delete("/api/pbs/none");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "PB not found", statusCode: 404 });
  });

  it("returns 204 on successful delete", async () => {
    mockSql.mockResolvedValue([{ id: "pb-1" }]);
    const res = await request(app).delete("/api/pbs/pb-1");
    expect(res.status).toBe(204);
  });
});
