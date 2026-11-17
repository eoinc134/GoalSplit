import type { HrZoneBoundary, HrZoneMinutes, IntensityProfile, WeeklyIntensityPoint } from "@goalsplit/types";
import type { HrBucket } from "./activity-metrics.js";
import { weekSpine, type AnalyticsActivity } from "./analytics-activity.js";
import { addDaysUtc, weekStartOf } from "./dates.js";
import { zoneForHeartrate } from "./hr-zones.js";

// Below this, a week's distribution is too thin to label.
const MIN_PROFILE_MINUTES = 30;
const POLARIZED_PI = 2;

export function zoneMinutesFromHistogram(histogram: HrBucket[], zones: HrZoneBoundary[]): HrZoneMinutes[] {
  const seconds: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const [bpm, s] of histogram) seconds[zoneForHeartrate(bpm, zones)] += s;
  return ([1, 2, 3, 4, 5] as const).map((zone) => ({ zone, minutes: seconds[zone] / 60 }));
}

export function addZoneMinutes(a: HrZoneMinutes[], b: HrZoneMinutes[]): HrZoneMinutes[] {
  return a.map((z, i) => ({ zone: z.zone, minutes: z.minutes + (b[i]?.minutes ?? 0) }));
}

export function emptyZoneMinutes(): HrZoneMinutes[] {
  return ([1, 2, 3, 4, 5] as const).map((zone) => ({ zone, minutes: 0 }));
}

// Treff et al. (2019): PI = log10(Z1/Z2 × Z3 × 100), Z as fractions of a
// 3-zone model. Undefined when Z2 or Z3 is empty.
export function polarizationIndex(low: number, moderate: number, high: number): number | null {
  const total = low + moderate + high;
  if (total <= 0 || moderate <= 0 || high <= 0) return null;
  return Math.log10((low / moderate) * (high / total) * 100);
}

// Seiler's 3-zone model sits on ventilatory thresholds we don't have, so it's
// approximated from the 5 HR zones: Z1–2 low, Z3 moderate, Z4–5 high.
export function summarizeIntensity(minutesByZone: HrZoneMinutes[]): Omit<WeeklyIntensityPoint, "weekStart" | "isPartialWeek"> {
  const m = (zone: number) => minutesByZone.find((z) => z.zone === zone)?.minutes ?? 0;
  const lowMinutes = m(1) + m(2);
  const moderateMinutes = m(3);
  const highMinutes = m(4) + m(5);
  const total = lowMinutes + moderateMinutes + highMinutes;
  const pi = polarizationIndex(lowMinutes, moderateMinutes, highMinutes);

  let profile: IntensityProfile = "insufficient-data";
  if (total >= MIN_PROFILE_MINUTES) {
    if (pi !== null && pi > POLARIZED_PI && lowMinutes > highMinutes && highMinutes > moderateMinutes) profile = "polarized";
    else if (lowMinutes >= moderateMinutes && lowMinutes >= highMinutes) profile = "pyramidal";
    else if (moderateMinutes >= highMinutes) profile = "threshold";
    else profile = "high-intensity";
  }

  return {
    minutesByZone,
    lowMinutes,
    moderateMinutes,
    highMinutes,
    lowPct: total > 0 ? (lowMinutes / total) * 100 : null,
    polarizationIndex: pi,
    profile,
  };
}

// The last `weeks` calendar weeks (the current one partial) of 3-zone
// intensity, oldest first, plus the pooled distribution across them.
// `activities` must cover the window; anything earlier is ignored.
export function weeklyIntensity(
  activities: AnalyticsActivity[],
  zones: HrZoneBoundary[],
  todayLocal: string,
  weeks: number,
): { weekly: WeeklyIntensityPoint[]; overall: Omit<WeeklyIntensityPoint, "weekStart" | "isPartialWeek">; inWindow: AnalyticsActivity[] } {
  const currentWeek = weekStartOf(todayLocal);
  const windowStart = addDaysUtc(currentWeek, -7 * (weeks - 1));
  const inWindow = activities.filter((a) => a.localDate >= windowStart);

  const byWeek = new Map<string, HrZoneMinutes[]>();
  for (const a of inWindow) {
    if (!a.metrics?.hasHr || zones.length === 0) continue;
    const wk = weekStartOf(a.localDate);
    byWeek.set(wk, addZoneMinutes(byWeek.get(wk) ?? emptyZoneMinutes(), zoneMinutesFromHistogram(a.metrics.hrHistogram, zones)));
  }

  const weekly: WeeklyIntensityPoint[] = weekSpine(windowStart, todayLocal).map((weekStart) => ({
    weekStart,
    ...summarizeIntensity(byWeek.get(weekStart) ?? emptyZoneMinutes()),
    isPartialWeek: weekStart === currentWeek,
  }));
  const overall = summarizeIntensity([...byWeek.values()].reduce((acc, week) => addZoneMinutes(acc, week), emptyZoneMinutes()));
  return { weekly, overall, inWindow };
}
