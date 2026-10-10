import type { HrZoneBoundary, RunClass } from "@goalsplit/types";
import { averageHr, overallSegment, type ActivityMetrics } from "./activity-metrics.js";

// Strava's own run workout_type tag: 0 default, 1 race, 2 long run, 3 workout.
const STRAVA_WORKOUT_TYPE: Record<number, RunClass> = { 1: "race", 2: "long", 3: "workout" };

export const LONG_RUN_MIN_S = 90 * 60;
export const WEEK_LONGEST_MIN_S = 60 * 60;
const WORKOUT_HARD_SHARE = 0.15; // ≥15% of HR time in Z4+
const RECOVERY_MAX_S = 50 * 60;
const HILLY_M_PER_KM = 15;

export interface RunClassInput {
  workoutType: number | null;
  movingTimeS: number;
  distanceM: number;
  elevationGainM: number;
  isWeekLongest: boolean;
  metrics: ActivityMetrics | null;
  averageHeartrate: number | null;
  zones: HrZoneBoundary[];
}

export function isLongRun(movingTimeS: number, isWeekLongest: boolean): boolean {
  return movingTimeS >= LONG_RUN_MIN_S || (isWeekLongest && movingTimeS >= WEEK_LONGEST_MIN_S);
}

function hardShare(m: ActivityMetrics, z4MinBpm: number): number {
  let hard = 0;
  let total = 0;
  for (const [bpm, seconds] of m.hrHistogram) {
    total += seconds;
    if (bpm >= z4MinBpm) hard += seconds;
  }
  return total > 0 ? hard / total : 0;
}

// The athlete's own Strava tag wins; otherwise a rule-based guess from
// duration and HR distribution. Rules are deliberately simple and listed in
// docs/METHODS.md — the point is to compare like with like, not to be clever.
export function classifyRun(input: RunClassInput): { runClass: RunClass; classSource: "strava" | "inferred"; hilly: boolean } {
  const km = input.distanceM / 1000;
  const hilly = km > 0 && input.elevationGainM / km >= HILLY_M_PER_KM;
  const tagged = input.workoutType !== null ? STRAVA_WORKOUT_TYPE[input.workoutType] : undefined;
  if (tagged) return { runClass: tagged, classSource: "strava", hilly };

  const inferred = (runClass: RunClass) => ({ runClass, classSource: "inferred" as const, hilly });
  if (isLongRun(input.movingTimeS, input.isWeekLongest)) return inferred("long");

  const avgHr = input.metrics?.hasHr ? averageHr(overallSegment(input.metrics)) : input.averageHeartrate;
  if (avgHr === null || input.zones.length < 5) return inferred("unknown");

  const z2Min = input.zones[1].minBpm;
  const z4Min = input.zones[3].minBpm;
  const share = input.metrics?.hasHr ? hardShare(input.metrics, z4Min) : avgHr >= z4Min ? 1 : 0;
  if (share >= WORKOUT_HARD_SHARE) return inferred("workout");
  if (avgHr < z2Min && input.movingTimeS < RECOVERY_MAX_S) return inferred("recovery");
  return inferred("easy");
}

export function isAerobicClass(c: RunClass): boolean {
  return c === "easy" || c === "long" || c === "recovery";
}
