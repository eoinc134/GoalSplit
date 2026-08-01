export const ACTIVITY_TYPE_ICON: Record<string, string> = {
  Run: "🏃",
  Ride: "🚴",
  Swim: "🏊",
  Walk: "🚶",
  Hike: "⛰️",
};

export const ACTIVITY_FILTERS = [
  { label: "All",     value: "" },
  { label: "🏃 Run",  value: "Run" },
  { label: "🚴 Ride", value: "Ride" },
  { label: "🏊 Swim", value: "Swim" },
  { label: "🚶 Walk", value: "Walk" },
];

export const ACTIVITY_LEVEL_LABELS: Record<string, string> = {
  sedentary: "Sedentary (little/no exercise)",
  light: "Light (1-3 days/week)",
  moderate: "Moderate (3-5 days/week)",
  active: "Active (6-7 days/week)",
  very_active: "Very active (physical job or 2x/day training)",
};

export const NUTRITION_GOAL_LABELS: Record<string, string> = {
  cut: "Cut",
  maintain: "Maintain",
  bulk: "Bulk",
};

export const MEAL_TYPE_LABELS: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
  other: "Other",
};
