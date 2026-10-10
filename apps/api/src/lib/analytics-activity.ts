import type { ClassifiedRun, HrZoneBoundary } from "@goalsplit/types";
import type { ActivityMetrics } from "./activity-metrics.js";
import { classifyRun } from "./run-classification.js";
import { addDaysUtc, weekStartOf } from "./dates.js";

// One activity joined with its stored stream metrics — the common input to
// every per-run analysis in this folder.
export interface AnalyticsActivity {
  id: string;
  name: string;
  type: string;
  localDate: string; // YYYY-MM-DD
  movingTimeS: number;
  distanceM: number;
  elevationGainM: number;
  averageHeartrate: number | null;
  workoutType: number | null; // Strava's tag from the list payload
  isWeekLongest: boolean; // longest Run (by moving time) in its Mon–Sun week
  metrics: ActivityMetrics | null; // null until streams are backfilled and processed
}

export function toClassifiedRun(a: AnalyticsActivity, zones: HrZoneBoundary[]): ClassifiedRun {
  return {
    activityId: a.id,
    activityName: a.name,
    localDate: a.localDate,
    ...classifyRun({
      workoutType: a.workoutType,
      movingTimeS: a.movingTimeS,
      distanceM: a.distanceM,
      elevationGainM: a.elevationGainM,
      isWeekLongest: a.isWeekLongest,
      metrics: a.metrics,
      averageHeartrate: a.averageHeartrate,
      zones,
    }),
  };
}

// Mondays from the window's first week through the current week, oldest first.
export function weekSpine(windowStart: string, todayLocal: string): string[] {
  const weeks: string[] = [];
  const last = weekStartOf(todayLocal);
  for (let wk = weekStartOf(windowStart); wk <= last; wk = addDaysUtc(wk, 7)) weeks.push(wk);
  return weeks;
}
