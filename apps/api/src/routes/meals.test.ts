import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../db/index.js", () => ({
  sql: vi.fn(),
  initSchema: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/usda-client.js", () => ({
  searchFoods: vi.fn(),
}));

import { app } from "../app.js";
import { sql } from "../db/index.js";
import { searchFoods } from "../lib/usda-client.js";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;
const mockSearchFoods = searchFoods as unknown as ReturnType<typeof vi.fn>;

function makeMealRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "meal-1",
    date: "2025-06-01",
    meal_type: "breakfast",
    name: "Chicken Breast",
    quantity_g: 150,
    fdc_id: "2187885",
    calories: 247.5,
    protein_g: 30.6,
    carbs_g: 1.59,
    fat_g: 12.15,
    created_at: new Date("2025-06-01T08:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/nutrition/meals", () => {
  it("returns meals for the date plus summed totals", async () => {
    mockSql.mockResolvedValueOnce([
      makeMealRow(),
      makeMealRow({ id: "meal-2", calories: 100, protein_g: 5, carbs_g: 10, fat_g: 2 }),
    ]);

    const res = await request(app).get("/api/nutrition/meals?date=2025-06-01");
    expect(res.status).toBe(200);
    expect(res.body.data.date).toBe("2025-06-01");
    expect(res.body.data.meals).toHaveLength(2);
    expect(res.body.data.calories).toBeCloseTo(347.5);
    expect(res.body.data.proteinG).toBeCloseTo(35.6);
  });
});

describe("POST /api/nutrition/meals", () => {
  it("rejects a request missing date or name", async () => {
    const res = await request(app).post("/api/nutrition/meals").send({ date: "2025-06-01" });
    expect(res.status).toBe(400);
  });

  it("scales per-100g macros by quantity when logging from a food search pick", async () => {
    mockSql.mockResolvedValueOnce([]); // foods_cache upsert
    mockSql.mockResolvedValueOnce([makeMealRow()]); // meals insert

    const res = await request(app).post("/api/nutrition/meals").send({
      date: "2025-06-01",
      mealType: "breakfast",
      name: "Chicken Breast",
      fdcId: "2187885",
      quantityG: 150,
      caloriesPer100g: 165,
      proteinGPer100g: 20.4,
      carbsGPer100g: 1.06,
      fatGPer100g: 8.1,
    });

    expect(res.status).toBe(201);
    // Second sql call is the meals insert — assert the scaled values passed in.
    const mealsInsertArgs = mockSql.mock.calls[1];
    const values = mealsInsertArgs.slice(1).map((v: unknown) => (Array.isArray(v) ? v[0] : v));
    expect(values).toContain(247.5); // 165 * 1.5
  });

  it("rejects a from-food request missing per-100g macro fields", async () => {
    const res = await request(app).post("/api/nutrition/meals").send({
      date: "2025-06-01",
      name: "Chicken Breast",
      fdcId: "2187885",
      quantityG: 150,
    });
    expect(res.status).toBe(400);
  });

  it("accepts a freeform meal with directly-provided macros", async () => {
    mockSql.mockResolvedValueOnce([makeMealRow({ fdc_id: null, quantity_g: null })]);

    const res = await request(app).post("/api/nutrition/meals").send({
      date: "2025-06-01",
      name: "Homemade stew",
      calories: 500,
      proteinG: 30,
      carbsG: 40,
      fatG: 20,
    });

    expect(res.status).toBe(201);
  });

  it("rejects a freeform meal missing macro fields", async () => {
    const res = await request(app)
      .post("/api/nutrition/meals")
      .send({ date: "2025-06-01", name: "Homemade stew" });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/nutrition/meals/:id", () => {
  it("returns 404 when not found", async () => {
    mockSql.mockResolvedValueOnce([]);
    const res = await request(app).delete("/api/nutrition/meals/none");
    expect(res.status).toBe(404);
  });

  it("returns 204 on successful delete", async () => {
    mockSql.mockResolvedValueOnce([{ id: "meal-1" }]);
    const res = await request(app).delete("/api/nutrition/meals/meal-1");
    expect(res.status).toBe(204);
  });
});

describe("GET /api/nutrition/foods/search", () => {
  it("returns an empty array without calling USDA for a blank query", async () => {
    const res = await request(app).get("/api/nutrition/foods/search?q=");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(mockSearchFoods).not.toHaveBeenCalled();
  });

  it("proxies to searchFoods and returns its results", async () => {
    mockSearchFoods.mockResolvedValueOnce([
      { fdcId: "1", description: "Chicken Breast", caloriesPer100g: 165, proteinGPer100g: 20.4, carbsGPer100g: 1.06, fatGPer100g: 8.1 },
    ]);
    const res = await request(app).get("/api/nutrition/foods/search?q=chicken");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(mockSearchFoods).toHaveBeenCalledWith("chicken");
  });

  it("returns 502 when the USDA lookup fails", async () => {
    mockSearchFoods.mockRejectedValueOnce(new Error("USDA food search failed: 500"));
    const res = await request(app).get("/api/nutrition/foods/search?q=chicken");
    expect(res.status).toBe(502);
  });
});

describe("GET /api/nutrition/foods/recent", () => {
  it("returns mapped cached foods", async () => {
    mockSql.mockResolvedValueOnce([
      {
        fdc_id: "2187885",
        description: "Chicken Breast",
        brand_owner: null,
        calories_per_100g: 165,
        protein_g_per_100g: 20.4,
        carbs_g_per_100g: 1.06,
        fat_g_per_100g: 8.1,
      },
    ]);
    const res = await request(app).get("/api/nutrition/foods/recent");
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ fdcId: "2187885", caloriesPer100g: 165 });
  });
});
