import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../db/index.js", () => ({
  sql: vi.fn(),
  initSchema: vi.fn().mockResolvedValue(undefined),
}));

import { app } from "../app.js";
import { sql } from "../db/index.js";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;

function makeGoalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "goal-1",
    name: "Run a 5K",
    description: null,
    category: "running",
    type: "distance",
    target_value: 5,
    current_value: 0,
    unit: "km",
    target_date: null,
    status: "active",
    prioritized: false,
    created_at: new Date("2024-01-01T00:00:00Z"),
    updated_at: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/goals", () => {
  it("returns empty array when no goals exist", async () => {
    mockSql.mockResolvedValue([]);
    const res = await request(app).get("/api/goals");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [] });
  });

  it("returns mapped goals with camelCase fields", async () => {
    mockSql.mockResolvedValue([makeGoalRow()]);
    const res = await request(app).get("/api/goals");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      id: "goal-1",
      name: "Run a 5K",
      targetValue: 5,
      currentValue: 0,
      status: "active",
      prioritized: false,
    });
  });

  it("maps createdAt as ISO string", async () => {
    mockSql.mockResolvedValue([makeGoalRow()]);
    const res = await request(app).get("/api/goals");
    expect(res.body.data[0].createdAt).toBe("2024-01-01T00:00:00.000Z");
  });
});

describe("GET /api/goals/:id", () => {
  it("returns 404 when goal not found", async () => {
    mockSql.mockResolvedValue([]);
    const res = await request(app).get("/api/goals/nonexistent");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Goal not found", statusCode: 404 });
  });

  it("returns goal when found", async () => {
    mockSql.mockResolvedValue([makeGoalRow()]);
    const res = await request(app).get("/api/goals/goal-1");
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe("goal-1");
  });
});

describe("POST /api/goals", () => {
  it("creates a goal and returns 201", async () => {
    mockSql.mockResolvedValue([makeGoalRow()]);
    const res = await request(app)
      .post("/api/goals")
      .send({ name: "Run a 5K", category: "running", type: "distance", targetValue: 5, unit: "km" });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe("Run a 5K");
  });

  it("returns the created goal with mapped fields", async () => {
    mockSql.mockResolvedValue([makeGoalRow({ target_value: 10, unit: "km" })]);
    const res = await request(app)
      .post("/api/goals")
      .send({ name: "Run 10K", category: "running", type: "distance", targetValue: 10, unit: "km" });
    expect(res.body.data.targetValue).toBe(10);
  });
});

describe("PATCH /api/goals/:id", () => {
  it("returns 404 when goal not found", async () => {
    mockSql.mockResolvedValue([]);
    const res = await request(app).patch("/api/goals/none").send({ name: "Updated" });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Goal not found", statusCode: 404 });
  });

  it("returns updated goal on success", async () => {
    mockSql.mockResolvedValue([makeGoalRow({ name: "Updated Name" })]);
    const res = await request(app).patch("/api/goals/goal-1").send({ name: "Updated Name" });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Updated Name");
  });

  it("can toggle prioritized to true", async () => {
    mockSql.mockResolvedValue([makeGoalRow({ prioritized: true })]);
    const res = await request(app).patch("/api/goals/goal-1").send({ prioritized: true });
    expect(res.body.data.prioritized).toBe(true);
  });
});

describe("DELETE /api/goals/:id", () => {
  it("returns 404 when goal not found", async () => {
    mockSql.mockResolvedValue([]);
    const res = await request(app).delete("/api/goals/none");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Goal not found", statusCode: 404 });
  });

  it("returns 204 on successful delete", async () => {
    mockSql.mockResolvedValue([{ id: "goal-1" }]);
    const res = await request(app).delete("/api/goals/goal-1");
    expect(res.status).toBe(204);
  });
});
