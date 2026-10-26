import type { GarminDayPoint, GarminDaysResponse } from "@goalsplit/types";

export const GARMIN_FALLBACK: GarminDaysResponse = { days: [], latestDay: null, lastSyncedAt: null };

type NumericField = {
  [K in keyof GarminDayPoint]: GarminDayPoint[K] extends number | null ? K : never;
}[keyof GarminDayPoint];

// The most recent day that actually has this metric. The newest row is often
// partial — today before the watch has synced, or a day it was barely worn —
// so "latest row" would show a blank card despite yesterday's value existing.
export function latestValue(days: GarminDayPoint[], field: NumericField): { value: number; day: string } | null {
  for (let i = days.length - 1; i >= 0; i--) {
    const value = days[i][field];
    if (typeof value === "number") return { value, day: days[i].day };
  }
  return null;
}
