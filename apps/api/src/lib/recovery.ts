import type {
  BedtimeConsistency,
  DailyLoadPoint,
  GarminDayPoint,
  MeanWithCi,
  NextMorningGroup,
  Readiness,
  ReadinessComponent,
  RestingHrBaselinePoint,
} from "@goalsplit/types";
import { addDaysUtc } from "./dates.js";
import { mean, standardDeviation } from "./stats.js";

// Recovery analysis on Garmin wellness data plus training load. Every rule is
// relative to the athlete's own recent history, not population norms — see
// docs/METHODS.md "Recovery".

export const BASELINE_DAYS = 28;
const MIN_BASELINE_VALUES = 7;
const ELEVATED_SD = 2;
const ELEVATED_MIN_BPM = 3;
const MIN_SLEEP_NIGHTS = 5;
const FORM_BASELINE_DAYS = 90;
const Z_CLAMP = 3;

function sampleSd(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values)!;
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1));
}

// Values of `field` on the `days` calendar days before `day` (excluding it).
function priorValues(byDay: Map<string, GarminDayPoint>, day: string, days: number, pick: (d: GarminDayPoint) => number | null): number[] {
  const out: number[] = [];
  for (let i = 1; i <= days; i++) {
    const v = byDay.get(addDaysUtc(day, -i));
    const x = v ? pick(v) : null;
    if (x !== null) out.push(x);
  }
  return out;
}

// Each day's resting HR against the mean and SD of the previous 28 days. A
// raised resting HR relative to your own norm is a classic early sign of
// accumulated fatigue or oncoming illness.
export function restingHrBaseline(days: GarminDayPoint[]): RestingHrBaselinePoint[] {
  const byDay = new Map(days.map((d) => [d.day, d]));
  return days
    .filter((d) => d.restingHeartRate !== null)
    .map((d) => {
      const prior = priorValues(byDay, d.day, BASELINE_DAYS, (x) => x.restingHeartRate);
      const restingHr = d.restingHeartRate!;
      if (prior.length < MIN_BASELINE_VALUES) {
        return { day: d.day, restingHr, baseline: null, bandLow: null, bandHigh: null, deviation: null, elevated: false };
      }
      const baseline = mean(prior)!;
      const sd = sampleSd(prior) ?? 0;
      const deviation = restingHr - baseline;
      return {
        day: d.day,
        restingHr,
        baseline,
        bandLow: baseline - sd,
        bandHigh: baseline + sd,
        deviation,
        elevated: deviation > ELEVATED_SD * sd && deviation >= ELEVATED_MIN_BPM,
      };
    });
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function hhmm(totalMinutes: number): string {
  const m = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// Mean bed and wake times over the last 28 nights, and how much bedtime
// varies. Bedtimes are measured from noon so 23:30 and 00:30 average to
// midnight rather than to midday.
export function bedtimeConsistency(days: GarminDayPoint[], today: string): BedtimeConsistency | null {
  const from = addDaysUtc(today, -(BASELINE_DAYS - 1));
  const nights = days.filter((d) => d.day >= from && d.sleepStartLocal && d.sleepEndLocal);
  if (nights.length < MIN_SLEEP_NIGHTS) return null;
  const sinceNoon = nights.map((d) => (minutes(d.sleepStartLocal!.slice(11, 16)) - 720 + 1440) % 1440);
  const wake = nights.map((d) => minutes(d.sleepEndLocal!.slice(11, 16)));
  return {
    nights: nights.length,
    meanBedtime: hhmm(720 + mean(sinceNoon)!),
    meanWake: hhmm(mean(wake)!),
    sdMinutes: Math.round(standardDeviation(sinceNoon)!),
  };
}

export function meanWithCi(values: number[]): MeanWithCi | null {
  if (values.length < 2) return null;
  const m = mean(values)!;
  const half = (1.96 * (sampleSd(values) ?? 0)) / Math.sqrt(values.length);
  return { mean: m, ciLow: m - half, ciHigh: m + half, n: values.length };
}

// How the next morning looks after rest days and after easy, moderate and
// hard training days — thirds of the athlete's own training days ranked by
// TRIMP. Ranking (not quantile cut-offs) keeps the thirds equal-sized even
// when many days share a load.
export function nextMorningResponse(
  daily: DailyLoadPoint[],
  garminDays: GarminDayPoint[],
  rhr: RestingHrBaselinePoint[],
): NextMorningGroup[] {
  const garminByDay = new Map(garminDays.map((d) => [d.day, d]));
  const deviationByDay = new Map(rhr.filter((r) => r.deviation !== null).map((r) => [r.day, r.deviation!]));
  const ranked = daily.filter((d) => d.activityCount > 0).sort((a, b) => a.load - b.load);
  if (ranked.length < 3) return [];
  const third = new Map<string, NextMorningGroup["group"]>();
  ranked.forEach((d, i) => {
    let g: NextMorningGroup["group"] = "hard";
    if (i < ranked.length / 3) g = "easy";
    else if (i < (2 * ranked.length) / 3) g = "moderate";
    third.set(d.date, g);
  });

  const groups: Record<NextMorningGroup["group"], { loads: number[]; rhr: number[]; sleep: number[]; bb: number[] }> = {
    rest: { loads: [], rhr: [], sleep: [], bb: [] },
    easy: { loads: [], rhr: [], sleep: [], bb: [] },
    moderate: { loads: [], rhr: [], sleep: [], bb: [] },
    hard: { loads: [], rhr: [], sleep: [], bb: [] },
  };
  for (const d of daily) {
    const group = third.get(d.date) ?? "rest";
    const next = addDaysUtc(d.date, 1);
    const g = garminByDay.get(next);
    const dev = deviationByDay.get(next);
    if (!g && dev === undefined) continue;
    const bucket = groups[group];
    bucket.loads.push(d.load);
    if (dev !== undefined) bucket.rhr.push(dev);
    if (g?.sleepDurationHours != null) bucket.sleep.push(g.sleepDurationHours);
    if (g?.bodyBatteryHigh != null) bucket.bb.push(g.bodyBatteryHigh);
  }

  return (Object.keys(groups) as NextMorningGroup["group"][]).map((group) => {
    const b = groups[group];
    return {
      group,
      loadRange: b.loads.length ? [Math.min(...b.loads), Math.max(...b.loads)] : [0, 0],
      days: b.loads.length,
      restingHrDeviation: meanWithCi(b.rhr),
      sleepHours: meanWithCi(b.sleep),
      bodyBatteryHigh: meanWithCi(b.bb),
    };
  });
}

function zScore(value: number, prior: number[], minValues: number): { baseline: number; z: number } | null {
  if (prior.length < minValues) return null;
  const sd = sampleSd(prior);
  if (!sd) return null;
  const baseline = mean(prior)!;
  return { baseline, z: Math.max(-Z_CLAMP, Math.min(Z_CLAMP, (value - baseline) / sd)) };
}

// A transparent morning readiness score: how today's resting HR, last night's
// sleep, Body Battery and training form compare with your own recent norms.
// Each becomes a z-score (positive = better recovered than usual); the score
// is 50 + 10 × their mean, so 50 is "a normal day for you". It describes, it
// doesn't prescribe — and every component is shown.
export function readiness(
  garminDays: GarminDayPoint[],
  rhr: RestingHrBaselinePoint[],
  daily: DailyLoadPoint[],
): Readiness | null {
  const morning = [...garminDays]
    .reverse()
    .find((d) => d.restingHeartRate !== null || d.sleepDurationHours !== null || d.bodyBatteryHigh !== null);
  if (!morning) return null;
  const byDay = new Map(garminDays.map((d) => [d.day, d]));
  const components: ReadinessComponent[] = [];

  const r = rhr.find((p) => p.day === morning.day);
  if (r?.baseline != null && r.bandHigh != null && r.bandHigh > r.baseline) {
    const sd = r.bandHigh - r.baseline;
    components.push({
      key: "restingHr",
      label: "Resting HR",
      value: r.restingHr,
      baseline: r.baseline,
      unit: "bpm",
      z: Math.max(-Z_CLAMP, Math.min(Z_CLAMP, -(r.restingHr - r.baseline) / sd)), // lower is better
    });
  }

  if (morning.sleepDurationHours !== null) {
    const s = zScore(morning.sleepDurationHours, priorValues(byDay, morning.day, BASELINE_DAYS, (d) => d.sleepDurationHours), MIN_SLEEP_NIGHTS);
    if (s) components.push({ key: "sleep", label: "Sleep", value: morning.sleepDurationHours, baseline: s.baseline, unit: "h", z: s.z });
  }

  if (morning.bodyBatteryHigh !== null) {
    const b = zScore(morning.bodyBatteryHigh, priorValues(byDay, morning.day, BASELINE_DAYS, (d) => d.bodyBatteryHigh), MIN_BASELINE_VALUES);
    if (b) components.push({ key: "bodyBattery", label: "Body Battery peak", value: morning.bodyBatteryHigh, baseline: b.baseline, unit: "", z: b.z });
  }

  const formIdx = daily.findIndex((d) => d.date === morning.day);
  if (formIdx > 0) {
    const prior = daily.slice(Math.max(0, formIdx - FORM_BASELINE_DAYS), formIdx).map((d) => d.tsb);
    const f = zScore(daily[formIdx].tsb, prior, MIN_BASELINE_VALUES);
    if (f) components.push({ key: "form", label: "Form (TSB)", value: daily[formIdx].tsb, baseline: f.baseline, unit: "", z: f.z });
  }

  if (components.length < 2) return null;
  const score = Math.round(Math.max(0, Math.min(100, 50 + 10 * mean(components.map((c) => c.z))!)));
  let label: Readiness["label"] = "Normal";
  if (score >= 60) label = "Above your normal";
  else if (score <= 40) label = "Below your normal";
  return { day: morning.day, score, label, components };
}
