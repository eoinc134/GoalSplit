import type { ActivityLevel, NutritionProfile, NutritionTargets, Sex } from "@goalsplit/types";

export const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

// Mifflin-St Jeor equation.
export function calculateBmr(params: {
  weightKg: number;
  heightCm: number;
  age: number;
  sex: Sex;
}): number {
  const { weightKg, heightCm, age, sex } = params;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === "male" ? base + 5 : base - 161;
}

export function calculateTdee(bmr: number, activityLevel: ActivityLevel): number {
  return bmr * ACTIVITY_MULTIPLIERS[activityLevel];
}

function ageFromBirthDate(birthDate: string): number {
  const birth = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const hadBirthdayThisYear =
    now.getMonth() > birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() >= birth.getDate());
  if (!hadBirthdayThisYear) age--;
  return age;
}

export function calculateTargets(
  profile: NutritionProfile,
  latestWeightKg: number | null,
): NutritionTargets {
  if (!profile.heightCm || !profile.sex || !profile.birthDate) {
    return {
      calculable: false,
      reason: "Add your height, sex, and birth date to your profile to calculate targets.",
    };
  }
  if (!latestWeightKg) {
    return { calculable: false, reason: "Log a weigh-in to calculate targets." };
  }

  const age = ageFromBirthDate(profile.birthDate);
  const bmr = calculateBmr({
    weightKg: latestWeightKg,
    heightCm: profile.heightCm,
    age,
    sex: profile.sex,
  });
  const tdee = calculateTdee(bmr, profile.activityLevel);
  const maintenanceCalories = profile.maintenanceOverride ?? Math.round(tdee);
  const targetCalories = maintenanceCalories + profile.calorieOffset;

  const targetProteinG = Math.round(profile.proteinGPerKg * latestWeightKg);
  const proteinCal = targetProteinG * 4;
  const fatCal = targetCalories * profile.fatPct;
  const targetFatG = Math.round(fatCal / 9);
  const carbCal = Math.max(0, targetCalories - proteinCal - fatCal);
  const targetCarbsG = Math.round(carbCal / 4);

  return { calculable: true, maintenanceCalories, targetCalories, targetProteinG, targetCarbsG, targetFatG };
}
