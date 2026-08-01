import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../db/index.js", () => ({
  sql: vi.fn(),
  initSchema: vi.fn().mockResolvedValue(undefined),
}));

import { app } from "../app.js";
import { sql } from "../db/index.js";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;

function makeProfileRow(overrides: Record<string, unknown> = {}) {
  return {
    height_cm: 180,
    sex: "male",
    birth_date: "1995-06-14",
    activity_level: "moderate",
    goal: "cut",
    calorie_offset: -500,
    maintenance_override: null,
    protein_g_per_kg: 1.8,
    fat_pct: 0.25,
    updated_at: new Date("2025-06-01T00:00:00Z"),
    ...overrides,
  };
}

function makeWeightRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "w-1",
    date: "2025-06-01",
    weight_kg: 80,
    notes: null,
    created_at: new Date("2025-06-01T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/nutrition/profile", () => {
  it("returns sane defaults when no profile has been saved", async () => {
    mockSql.mockResolvedValueOnce([]);
    const res = await request(app).get("/api/nutrition/profile");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      activityLevel: "moderate",
      goal: "maintain",
      calorieOffset: 0,
      proteinGPerKg: 1.8,
      fatPct: 0.25,
    });
    expect(res.body.data.heightCm).toBeUndefined();
  });

  it("returns the mapped, saved profile", async () => {
    mockSql.mockResolvedValueOnce([makeProfileRow()]);
    const res = await request(app).get("/api/nutrition/profile");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      heightCm: 180,
      sex: "male",
      birthDate: "1995-06-14",
      goal: "cut",
      calorieOffset: -500,
    });
  });
});

describe("PATCH /api/nutrition/profile", () => {
  it("upserts and returns the mapped profile", async () => {
    mockSql.mockResolvedValueOnce([makeProfileRow({ height_cm: 182 })]);
    const res = await request(app).patch("/api/nutrition/profile").send({ heightCm: 182 });
    expect(res.status).toBe(200);
    expect(res.body.data.heightCm).toBe(182);
  });
});

describe("GET /api/nutrition/targets", () => {
  it("reports not calculable when profile and weight are both unset", async () => {
    mockSql.mockResolvedValueOnce([]); // profile
    mockSql.mockResolvedValueOnce([]); // latest weight
    const res = await request(app).get("/api/nutrition/targets");
    expect(res.status).toBe(200);
    expect(res.body.data.calculable).toBe(false);
  });

  it("computes targets when profile and a weigh-in exist", async () => {
    mockSql.mockResolvedValueOnce([makeProfileRow()]); // profile
    mockSql.mockResolvedValueOnce([{ weight_kg: 80 }]); // latest weight
    const res = await request(app).get("/api/nutrition/targets");
    expect(res.status).toBe(200);
    expect(res.body.data.calculable).toBe(true);
    expect(res.body.data.targetCalories).toBeGreaterThan(0);
  });
});

describe("GET /api/nutrition/weight", () => {
  it("returns mapped weight log history", async () => {
    mockSql.mockResolvedValueOnce([makeWeightRow()]);
    const res = await request(app).get("/api/nutrition/weight");
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ id: "w-1", date: "2025-06-01", weightKg: 80 });
  });
});

describe("POST /api/nutrition/weight", () => {
  it("rejects a missing weightKg", async () => {
    const res = await request(app).post("/api/nutrition/weight").send({ date: "2025-06-01" });
    expect(res.status).toBe(400);
  });

  it("logs a weigh-in (upserting by date)", async () => {
    mockSql.mockResolvedValueOnce([makeWeightRow({ weight_kg: 79.5 })]);
    const res = await request(app)
      .post("/api/nutrition/weight")
      .send({ date: "2025-06-01", weightKg: 79.5 });
    expect(res.status).toBe(201);
    expect(res.body.data.weightKg).toBe(79.5);
  });
});

describe("DELETE /api/nutrition/weight/:id", () => {
  it("returns 404 when not found", async () => {
    mockSql.mockResolvedValueOnce([]);
    const res = await request(app).delete("/api/nutrition/weight/none");
    expect(res.status).toBe(404);
  });

  it("returns 204 on successful delete", async () => {
    mockSql.mockResolvedValueOnce([{ id: "w-1" }]);
    const res = await request(app).delete("/api/nutrition/weight/w-1");
    expect(res.status).toBe(204);
  });
});
