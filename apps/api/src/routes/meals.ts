import { Router } from "express";
import type { DailyNutritionTotals, FoodSearchResult, Meal, MealType } from "@goalsplit/types";
import { sql } from "../db/index.js";
import { searchFoods } from "../lib/usda-client.js";

export const mealsRouter = Router();

interface MealRow {
  id: string;
  date: string;
  meal_type: string;
  name: string;
  quantity_g: number | null;
  fdc_id: string | null;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  created_at: Date;
}

function rowToMeal(row: MealRow): Meal {
  return {
    id: row.id,
    date: row.date,
    mealType: row.meal_type as MealType,
    name: row.name,
    quantityG: row.quantity_g ?? undefined,
    fdcId: row.fdc_id ?? undefined,
    calories: row.calories,
    proteinG: row.protein_g,
    carbsG: row.carbs_g,
    fatG: row.fat_g,
    createdAt: row.created_at.toISOString(),
  };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

mealsRouter.get("/meals", async (req, res) => {
  const date = typeof req.query.date === "string" ? req.query.date : todayIso();
  const rows = await sql<MealRow[]>`
    SELECT * FROM meals WHERE date = ${date} ORDER BY created_at ASC
  `;
  const meals = rows.map(rowToMeal);
  const totals: DailyNutritionTotals = {
    date,
    calories: meals.reduce((sum, m) => sum + m.calories, 0),
    proteinG: meals.reduce((sum, m) => sum + m.proteinG, 0),
    carbsG: meals.reduce((sum, m) => sum + m.carbsG, 0),
    fatG: meals.reduce((sum, m) => sum + m.fatG, 0),
    meals,
  };
  res.json({ data: totals });
});

// Two accepted request shapes:
//  - from a food search pick: { fdcId, quantityG, caloriesPer100g, proteinGPer100g, carbsGPer100g, fatGPer100g, ... }
//    (the client already has these per-100g numbers from GET /foods/search — no extra lookup needed)
//  - freeform: { calories, proteinG, carbsG, fatG }
mealsRouter.post("/meals", async (req, res) => {
  const { date, mealType, name } = req.body;
  if (!date || !name) {
    return res.status(400).json({ error: "date and name are required", statusCode: 400 });
  }

  const isFromFood = typeof req.body.fdcId === "string" && typeof req.body.quantityG === "number";

  let calories: number;
  let proteinG: number;
  let carbsG: number;
  let fatG: number;
  let fdcId: string | null = null;
  let quantityG: number | null = null;

  if (isFromFood) {
    const {
      fdcId: bodyFdcId,
      quantityG: bodyQuantityG,
      caloriesPer100g,
      proteinGPer100g,
      carbsGPer100g,
      fatGPer100g,
      brandOwner,
    } = req.body;

    if ([caloriesPer100g, proteinGPer100g, carbsGPer100g, fatGPer100g].some((v) => typeof v !== "number")) {
      return res.status(400).json({ error: "Missing per-100g macro fields", statusCode: 400 });
    }

    const scale = bodyQuantityG / 100;
    calories = caloriesPer100g * scale;
    proteinG = proteinGPer100g * scale;
    carbsG = carbsGPer100g * scale;
    fatG = fatGPer100g * scale;
    fdcId = bodyFdcId;
    quantityG = bodyQuantityG;

    await sql`
      INSERT INTO foods_cache (
        fdc_id, description, brand_owner, calories_per_100g, protein_g_per_100g, carbs_g_per_100g, fat_g_per_100g
      ) VALUES (
        ${bodyFdcId}, ${name}, ${brandOwner ?? null}, ${caloriesPer100g}, ${proteinGPer100g}, ${carbsGPer100g}, ${fatGPer100g}
      )
      ON CONFLICT (fdc_id) DO UPDATE SET
        description        = EXCLUDED.description,
        brand_owner         = EXCLUDED.brand_owner,
        calories_per_100g   = EXCLUDED.calories_per_100g,
        protein_g_per_100g  = EXCLUDED.protein_g_per_100g,
        carbs_g_per_100g    = EXCLUDED.carbs_g_per_100g,
        fat_g_per_100g      = EXCLUDED.fat_g_per_100g,
        cached_at           = NOW()
    `;
  } else {
    const { calories: c, proteinG: p, carbsG: cb, fatG: f } = req.body;
    if ([c, p, cb, f].some((v) => typeof v !== "number")) {
      return res
        .status(400)
        .json({ error: "calories, proteinG, carbsG, fatG are required for a freeform meal", statusCode: 400 });
    }
    calories = c;
    proteinG = p;
    carbsG = cb;
    fatG = f;
  }

  const [row] = await sql<MealRow[]>`
    INSERT INTO meals (id, date, meal_type, name, quantity_g, fdc_id, calories, protein_g, carbs_g, fat_g)
    VALUES (
      ${crypto.randomUUID()}, ${date}, ${mealType ?? "other"}, ${name},
      ${quantityG}, ${fdcId}, ${calories}, ${proteinG}, ${carbsG}, ${fatG}
    )
    RETURNING *
  `;
  return res.status(201).json({ data: rowToMeal(row) });
});

mealsRouter.delete("/meals/:id", async (req, res) => {
  const result = await sql`DELETE FROM meals WHERE id = ${req.params.id} RETURNING id`;
  if (result.length === 0) return res.status(404).json({ error: "Meal not found", statusCode: 404 });
  return res.status(204).send();
});

mealsRouter.get("/foods/search", async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!query) return res.json({ data: [] });

  try {
    const results = await searchFoods(query);
    return res.json({ data: results });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Food search failed";
    return res.status(502).json({ error: message, statusCode: 502 });
  }
});

interface FoodsCacheRow {
  fdc_id: string;
  description: string;
  brand_owner: string | null;
  calories_per_100g: number;
  protein_g_per_100g: number;
  carbs_g_per_100g: number;
  fat_g_per_100g: number;
}

function rowToFoodSearchResult(row: FoodsCacheRow): FoodSearchResult {
  return {
    fdcId: row.fdc_id,
    description: row.description,
    brandOwner: row.brand_owner ?? undefined,
    caloriesPer100g: row.calories_per_100g,
    proteinGPer100g: row.protein_g_per_100g,
    carbsGPer100g: row.carbs_g_per_100g,
    fatGPer100g: row.fat_g_per_100g,
  };
}

mealsRouter.get("/foods/recent", async (_req, res) => {
  const rows = await sql<FoodsCacheRow[]>`
    SELECT fdc_id, description, brand_owner, calories_per_100g, protein_g_per_100g, carbs_g_per_100g, fat_g_per_100g
    FROM foods_cache
    ORDER BY cached_at DESC
    LIMIT 20
  `;
  res.json({ data: rows.map(rowToFoodSearchResult) });
});
