import { Router } from "express";
import type { ActivityLevel, NutritionGoal, NutritionProfile, Sex, WeightLog } from "@goalsplit/types";
import { sql } from "../db/index.js";
import { calculateTargets } from "../lib/nutrition-calc.js";

export const nutritionRouter = Router();

interface NutritionProfileRow {
  height_cm: number | null;
  sex: string | null;
  birth_date: string | null;
  activity_level: string;
  goal: string;
  calorie_offset: number;
  maintenance_override: number | null;
  protein_g_per_kg: number;
  fat_pct: number;
  updated_at: Date;
}

function rowToProfile(row: NutritionProfileRow): NutritionProfile {
  return {
    heightCm: row.height_cm ?? undefined,
    sex: (row.sex as Sex) ?? undefined,
    birthDate: row.birth_date ?? undefined,
    activityLevel: row.activity_level as ActivityLevel,
    goal: row.goal as NutritionGoal,
    calorieOffset: row.calorie_offset,
    maintenanceOverride: row.maintenance_override ?? undefined,
    proteinGPerKg: row.protein_g_per_kg,
    fatPct: row.fat_pct,
    updatedAt: row.updated_at.toISOString(),
  };
}

const DEFAULT_PROFILE: NutritionProfile = {
  activityLevel: "moderate",
  goal: "maintain",
  calorieOffset: 0,
  proteinGPerKg: 1.8,
  fatPct: 0.25,
  updatedAt: new Date(0).toISOString(),
};

async function getProfile(): Promise<NutritionProfile> {
  const [row] = await sql<NutritionProfileRow[]>`
    SELECT * FROM nutrition_profile WHERE id = 'singleton'
  `;
  return row ? rowToProfile(row) : DEFAULT_PROFILE;
}

nutritionRouter.get("/profile", async (_req, res) => {
  res.json({ data: await getProfile() });
});

nutritionRouter.patch("/profile", async (req, res) => {
  const {
    heightCm,
    sex,
    birthDate,
    activityLevel,
    goal,
    calorieOffset,
    maintenanceOverride,
    proteinGPerKg,
    fatPct,
  } = req.body;

  const [row] = await sql<NutritionProfileRow[]>`
    INSERT INTO nutrition_profile (
      id, height_cm, sex, birth_date, activity_level, goal,
      calorie_offset, maintenance_override, protein_g_per_kg, fat_pct, updated_at
    ) VALUES (
      'singleton', ${heightCm ?? null}, ${sex ?? null}, ${birthDate ?? null},
      ${activityLevel ?? "moderate"}, ${goal ?? "maintain"}, ${calorieOffset ?? 0},
      ${maintenanceOverride ?? null}, ${proteinGPerKg ?? 1.8}, ${fatPct ?? 0.25}, NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      height_cm             = COALESCE(${heightCm ?? null}, nutrition_profile.height_cm),
      sex                   = COALESCE(${sex ?? null}, nutrition_profile.sex),
      birth_date            = COALESCE(${birthDate ?? null}, nutrition_profile.birth_date),
      activity_level        = COALESCE(${activityLevel ?? null}, nutrition_profile.activity_level),
      goal                  = COALESCE(${goal ?? null}, nutrition_profile.goal),
      calorie_offset        = COALESCE(${calorieOffset ?? null}, nutrition_profile.calorie_offset),
      maintenance_override  = COALESCE(${maintenanceOverride ?? null}, nutrition_profile.maintenance_override),
      protein_g_per_kg      = COALESCE(${proteinGPerKg ?? null}, nutrition_profile.protein_g_per_kg),
      fat_pct               = COALESCE(${fatPct ?? null}, nutrition_profile.fat_pct),
      updated_at            = NOW()
    RETURNING *
  `;

  res.json({ data: rowToProfile(row) });
});

nutritionRouter.get("/targets", async (_req, res) => {
  const profile = await getProfile();
  const [latest] = await sql<{ weight_kg: number }[]>`
    SELECT weight_kg FROM weight_logs ORDER BY date DESC LIMIT 1
  `;
  res.json({ data: calculateTargets(profile, latest?.weight_kg ?? null) });
});

interface WeightLogRow {
  id: string;
  date: string;
  weight_kg: number;
  notes: string | null;
  created_at: Date;
}

function rowToWeightLog(row: WeightLogRow): WeightLog {
  return {
    id: row.id,
    date: row.date,
    weightKg: row.weight_kg,
    notes: row.notes ?? undefined,
    createdAt: row.created_at.toISOString(),
  };
}

nutritionRouter.get("/weight", async (req, res) => {
  const limit = Math.min(Number.parseInt(String(req.query.limit ?? "90")) || 90, 365);
  const rows = await sql<WeightLogRow[]>`
    SELECT * FROM weight_logs ORDER BY date DESC LIMIT ${limit}
  `;
  res.json({ data: rows.map(rowToWeightLog) });
});

nutritionRouter.post("/weight", async (req, res) => {
  const { date, weightKg, notes } = req.body;
  if (!date || typeof weightKg !== "number") {
    return res.status(400).json({ error: "date and weightKg are required", statusCode: 400 });
  }

  const [row] = await sql<WeightLogRow[]>`
    INSERT INTO weight_logs (id, date, weight_kg, notes)
    VALUES (${crypto.randomUUID()}, ${date}, ${weightKg}, ${notes ?? null})
    ON CONFLICT (date) DO UPDATE SET weight_kg = EXCLUDED.weight_kg, notes = EXCLUDED.notes
    RETURNING *
  `;
  return res.status(201).json({ data: rowToWeightLog(row) });
});

nutritionRouter.delete("/weight/:id", async (req, res) => {
  const result = await sql`DELETE FROM weight_logs WHERE id = ${req.params.id} RETURNING id`;
  if (result.length === 0) return res.status(404).json({ error: "Weight log not found", statusCode: 404 });
  return res.status(204).send();
});
