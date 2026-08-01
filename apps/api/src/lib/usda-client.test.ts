import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchFoods } from "./usda-client.js";

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

beforeEach(() => {
  delete process.env.USDA_API_KEY;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchFoods", () => {
  it("maps USDA foodNutrients into flat per-100g macro fields", async () => {
    mockFetchOnce({
      foods: [
        {
          fdcId: 2187885,
          description: "CHICKEN BREAST",
          brandOwner: "Giant Eagle, Inc.",
          foodNutrients: [
            { nutrientId: 1003, value: 20.4 }, // protein
            { nutrientId: 1004, value: 8.1 }, // fat
            { nutrientId: 1005, value: 1.06 }, // carbs
            { nutrientId: 1008, value: 165 }, // energy
          ],
        },
      ],
    });

    const results = await searchFoods("chicken breast");

    expect(results).toEqual([
      {
        fdcId: "2187885",
        description: "CHICKEN BREAST",
        brandOwner: "Giant Eagle, Inc.",
        caloriesPer100g: 165,
        proteinGPer100g: 20.4,
        carbsGPer100g: 1.06,
        fatGPer100g: 8.1,
      },
    ]);
  });

  it("defaults missing nutrients to 0 rather than throwing", async () => {
    mockFetchOnce({
      foods: [{ fdcId: 1, description: "Mystery item", foodNutrients: [] }],
    });

    const [result] = await searchFoods("mystery");
    expect(result.caloriesPer100g).toBe(0);
    expect(result.proteinGPer100g).toBe(0);
  });

  it("throws when the USDA API responds with an error status", async () => {
    mockFetchOnce({}, false, 403);
    await expect(searchFoods("chicken")).rejects.toThrow("USDA food search failed: 403");
  });

  it("uses the DEMO_KEY fallback when USDA_API_KEY is unset", async () => {
    mockFetchOnce({ foods: [] });
    await searchFoods("chicken");
    const calledUrl = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("api_key=DEMO_KEY");
  });

  it("uses USDA_API_KEY from the environment when set", async () => {
    process.env.USDA_API_KEY = "real-key-123";
    mockFetchOnce({ foods: [] });
    await searchFoods("chicken");
    const calledUrl = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("api_key=real-key-123");
  });
});
