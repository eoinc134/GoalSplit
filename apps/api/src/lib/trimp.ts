import type { AthletePhysiology, LoadSource } from "@goalsplit/types";
import type { HrBucket } from "./activity-metrics.js";

// Banister (1991) TRIMP: minutes × HRr × a·e^(k·HRr), where HRr is the
// fraction of heart-rate reserve. The exponential weights time near max far
// more heavily than easy time. Coefficients come in pairs: a = 0.64, k = 1.92
// for men; a = 0.86, k = 1.67 for women.
export const TRIMP_K_MALE = 1.92;
export const TRIMP_K_FEMALE = 1.67;
const MULTIPLIER_MALE = 0.64;
const MULTIPLIER_FEMALE = 0.86;

export function trimpCoefficientFor(sex: "M" | "F" | null): number {
  return sex === "F" ? TRIMP_K_FEMALE : TRIMP_K_MALE;
}

type TrimpInputs = Pick<AthletePhysiology, "hrMax" | "hrRest" | "trimpCoefficient">;

export function trimpWeight(bpm: number, p: TrimpInputs): number {
  if (p.hrMax === null || p.hrMax <= p.hrRest) return 0;
  const hrr = Math.max(0, Math.min(1, (bpm - p.hrRest) / (p.hrMax - p.hrRest)));
  const a = p.trimpCoefficient === TRIMP_K_FEMALE ? MULTIPLIER_FEMALE : MULTIPLIER_MALE;
  return hrr * a * Math.exp(p.trimpCoefficient * hrr);
}

// Exact per-sample TRIMP — the weight depends only on bpm, so summing over
// the histogram equals summing over the raw stream.
export function trimpFromHistogram(histogram: HrBucket[], p: TrimpInputs): number {
  return histogram.reduce((sum, [bpm, seconds]) => sum + (seconds / 60) * trimpWeight(bpm, p), 0);
}

// Banister's original whole-session form, for activities with only a summary
// average HR. It underestimates interval sessions (the exponential is applied
// to the mean, not each sample), so stream-based load is always preferred.
export function trimpFromAverage(avgHr: number, movingTimeS: number, p: TrimpInputs): number {
  return (movingTimeS / 60) * trimpWeight(avgHr, p);
}

export interface ActivityLoadSource {
  histogram: HrBucket[] | null; // from activity_metrics, when streams had HR
  averageHeartrate: number | null;
  movingTimeS: number;
}

export function activityLoad(a: ActivityLoadSource, p: TrimpInputs): { load: number; source: LoadSource } {
  if (p.hrMax === null) return { load: 0, source: "none" };
  if (a.histogram && a.histogram.length > 0) return { load: trimpFromHistogram(a.histogram, p), source: "stream" };
  if (a.averageHeartrate !== null && a.averageHeartrate > 0) {
    return { load: trimpFromAverage(a.averageHeartrate, a.movingTimeS, p), source: "average-hr" };
  }
  return { load: 0, source: "none" };
}
