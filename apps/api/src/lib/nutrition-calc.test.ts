import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { calculateBmr, calculateTdee, calculateTargets, ACTIVITY_MULTIPLIERS } from "./nutrition-calc.js";
import type { NutritionProfile } from "@goalsplit/types";

function makeProfile(overrides: Partial<NutritionProfile> = {}): NutritionProfile {
  return {
    heightCm: 180,
    sex: "male",
    birthDate: "1995-06-14",
    activityLevel: "moderate",
    goal: "cut",
    calorieOffset: -500,
    proteinGPerKg: 1.8,
    fatPct: 0.25,
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("calculateBmr", () => {
  it("adds 5 for men (Mifflin-St Jeor)", () => {
    expect(calculateBmr({ weightKg: 80, heightCm: 180, age: 30, sex: "male" })).toBe(1780);
  });

  it("subtracts 161 for women (Mifflin-St Jeor)", () => {
    expect(calculateBmr({ weightKg: 65, heightCm: 165, age: 28, sex: "female" })).toBeCloseTo(
      10 * 65 + 6.25 * 165 - 5 * 28 - 161,
    );
  });
});

describe("calculateTdee", () => {
  it("applies the activity multiplier", () => {
    expect(calculateTdee(1780, "moderate")).toBeCloseTo(1780 * ACTIVITY_MULTIPLIERS.moderate);
    expect(calculateTdee(1780, "sedentary")).toBeCloseTo(1780 * 1.2);
  });
});

describe("calculateTargets", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports not calculable when profile is missing height/sex/birthDate", () => {
    const result = calculateTargets(makeProfile({ heightCm: undefined }), 80);
    expect(result.calculable).toBe(false);
    expect(result.reason).toMatch(/height/i);
  });

  it("reports not calculable when there's no weigh-in yet", () => {
    const result = calculateTargets(makeProfile(), null);
    expect(result.calculable).toBe(false);
    expect(result.reason).toMatch(/weigh-in/i);
  });

  it("computes maintenance, target calories, and macros for a cut", () => {
    // age 30 as of 2025-06-15 given birthDate 1995-06-14 (birthday already passed)
    const result = calculateTargets(makeProfile(), 80);

    expect(result.calculable).toBe(true);
    expect(result.maintenanceCalories).toBe(2759); // round(1780 * 1.55)
    expect(result.targetCalories).toBe(2259); // maintenance - 500 (cut offset)
    expect(result.targetProteinG).toBe(144); // round(1.8 * 80)
    expect(result.targetFatG).toBe(63); // round((2259 * 0.25) / 9)
    expect(result.targetCarbsG).toBe(280); // round((2259 - 576 - 564.75) / 4)
  });

  it("uses the manual maintenance override instead of the calculated TDEE", () => {
    const result = calculateTargets(makeProfile({ maintenanceOverride: 3000, calorieOffset: 0 }), 80);
    expect(result.maintenanceCalories).toBe(3000);
    expect(result.targetCalories).toBe(3000);
  });

  it("floors carbs at 0 rather than going negative", () => {
    const result = calculateTargets(
      makeProfile({ maintenanceOverride: 1000, calorieOffset: 0, proteinGPerKg: 3, fatPct: 0.6 }),
      80,
    );
    expect(result.targetCarbsG).toBe(0);
  });

  it("accounts for a birthday that hasn't happened yet this year", () => {
    // "now" is 2025-06-15; a birthDate of 1995-07-01 means the birthday hasn't
    // happened yet this year, so age should be 29, not 30.
    const withBirthdayPassed = calculateTargets(makeProfile({ birthDate: "1995-06-14" }), 80);
    const withBirthdayUpcoming = calculateTargets(makeProfile({ birthDate: "1995-07-01" }), 80);
    expect(withBirthdayPassed.maintenanceCalories).not.toBe(withBirthdayUpcoming.maintenanceCalories);
  });
});
