import type { FoodSearchResult } from "@goalsplit/types";

const USDA_API = "https://api.nal.usda.gov/fdc/v1";

// USDA nutrient IDs — stable across data types (Foundation, SR Legacy, Branded, Survey).
const NUTRIENT_ID_ENERGY_KCAL = 1008;
const NUTRIENT_ID_PROTEIN_G = 1003;
const NUTRIENT_ID_FAT_G = 1004;
const NUTRIENT_ID_CARBS_G = 1005;

interface UsdaFoodNutrient {
  nutrientId: number;
  value: number;
}

interface UsdaFoodSearchItem {
  fdcId: number;
  description: string;
  brandOwner?: string;
  foodNutrients: UsdaFoodNutrient[];
}

interface UsdaFoodSearchResponse {
  foods: UsdaFoodSearchItem[];
}

function nutrientValue(nutrients: UsdaFoodNutrient[], nutrientId: number): number {
  return nutrients.find((n) => n.nutrientId === nutrientId)?.value ?? 0;
}

function toFoodSearchResult(item: UsdaFoodSearchItem): FoodSearchResult {
  return {
    fdcId: String(item.fdcId),
    description: item.description,
    brandOwner: item.brandOwner,
    // The search endpoint reports foodNutrients per 100g consistently across data types.
    caloriesPer100g: nutrientValue(item.foodNutrients, NUTRIENT_ID_ENERGY_KCAL),
    proteinGPer100g: nutrientValue(item.foodNutrients, NUTRIENT_ID_PROTEIN_G),
    carbsGPer100g: nutrientValue(item.foodNutrients, NUTRIENT_ID_CARBS_G),
    fatGPer100g: nutrientValue(item.foodNutrients, NUTRIENT_ID_FAT_G),
  };
}

export async function searchFoods(query: string): Promise<FoodSearchResult[]> {
  const apiKey = process.env.USDA_API_KEY ?? "DEMO_KEY";
  const params = new URLSearchParams({ query, pageSize: "25", api_key: apiKey });

  const res = await fetch(`${USDA_API}/foods/search?${params}`);
  if (!res.ok) throw new Error(`USDA food search failed: ${res.status}`);

  const body = (await res.json()) as UsdaFoodSearchResponse;
  return body.foods.map(toFoodSearchResult);
}
