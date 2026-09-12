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

// Strava's best_efforts distance names — mirrors apps/api/src/lib/personal-records.ts's
// CANONICAL_DISTANCE_LADDER, used here only to power the "Add PR" form's autocomplete.
export const PR_DISTANCE_LADDER = [
  "400m",
  "1/2 mile",
  "1K",
  "1 mile",
  "2 mile",
  "5K",
  "10K",
  "15K",
  "10 mile",
  "20K",
  "Half-Marathon",
  "30K",
  "Marathon",
];
