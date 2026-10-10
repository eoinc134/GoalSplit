import type { IntensityProfile } from "@goalsplit/types";

export const PROFILE_LABEL: Record<IntensityProfile, string> = {
  polarized: "Polarized",
  pyramidal: "Pyramidal (low-intensity dominant)",
  threshold: "Threshold-heavy",
  "high-intensity": "High-intensity dominant",
  "insufficient-data": "Not enough HR data",
};
