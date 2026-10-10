import type {
  AcwrBand,
  AthletePhysiology,
  DailyLoadPoint,
  LoadSource,
  TrainingLoadSummary,
  WeeklyLoadPoint,
} from "@goalsplit/types";
import { addDaysUtc, daysBetween, weekStartOf } from "./dates.js";

export interface LoadInput {
  localDate: string; // YYYY-MM-DD
  load: number;
  source: LoadSource;
}

// Banister fitness–fatigue model as popularised by Coggan (ATL/CTL/TSB):
// impulse-response decay constants of 7 and 42 days.
const ATL_TAU = 7;
const CTL_TAU = 42;
const ATL_K = 1 - Math.exp(-1 / ATL_TAU);
const CTL_K = 1 - Math.exp(-1 / CTL_TAU);

// EWMA ACWR (Williams et al. 2017): λ = 2/(N+1). Unlike the rolling-average
// version, the acute and chronic windows aren't mathematically coupled and
// recent days weigh more than days 3–4 weeks ago.
const ACWR_ACUTE_LAMBDA = 2 / (7 + 1);
const ACWR_CHRONIC_LAMBDA = 2 / (28 + 1);

// The 42-day CTL time constant needs about that long to stop reflecting the
// zero it was seeded with.
const WARMUP_DAYS = 42;
const WEEKLY_HISTORY = 12;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function classifyBand(acwr: number | null): AcwrBand | null {
  if (acwr === null) return null;
  if (acwr < 0.8) return "undertraining";
  if (acwr <= 1.3) return "sweet-spot";
  if (acwr <= 1.5) return "caution";
  return "high-risk";
}

// Foster (1998): mean ÷ SD of daily load across a week. Rest days count as
// zeros. Null when SD is 0 (identical loads every day, or a full rest week).
export function monotony(dailyLoads: number[]): number | null {
  if (dailyLoads.length === 0) return null;
  const mean = dailyLoads.reduce((s, v) => s + v, 0) / dailyLoads.length;
  const variance = dailyLoads.reduce((s, v) => s + (v - mean) ** 2, 0) / dailyLoads.length;
  const sd = Math.sqrt(variance);
  return sd > 0 ? mean / sd : null;
}

export function strain(dailyLoads: number[]): number | null {
  const m = monotony(dailyLoads);
  return m === null ? null : dailyLoads.reduce((s, v) => s + v, 0) * m;
}

// Every day from `fromDate` to `toDate` inclusive, so rest days are explicit
// zero-load rows that still decay ATL/CTL.
export function buildDailySeries(inputs: LoadInput[], fromDate: string, toDate: string): DailyLoadPoint[] {
  const byDate = new Map<string, { load: number; activityCount: number; scoredCount: number }>();
  for (const a of inputs) {
    const bucket = byDate.get(a.localDate) ?? { load: 0, activityCount: 0, scoredCount: 0 };
    bucket.activityCount += 1;
    bucket.load += a.load;
    if (a.source !== "none") bucket.scoredCount += 1;
    byDate.set(a.localDate, bucket);
  }

  const totalDays = daysBetween(fromDate, toDate) + 1;
  const series: DailyLoadPoint[] = [];
  let atl = 0;
  let ctl = 0;
  let ewmaAcute = 0;
  let ewmaChronic = 0;

  for (let i = 0; i < totalDays; i++) {
    const date = addDaysUtc(fromDate, i);
    const day = byDate.get(date) ?? { load: 0, activityCount: 0, scoredCount: 0 };
    // Form is yesterday's fitness minus yesterday's fatigue (TrainingPeaks
    // convention), so today's session doesn't make today look worse.
    const tsb = ctl - atl;
    atl += (day.load - atl) * ATL_K;
    ctl += (day.load - ctl) * CTL_K;
    ewmaAcute = day.load * ACWR_ACUTE_LAMBDA + ewmaAcute * (1 - ACWR_ACUTE_LAMBDA);
    ewmaChronic = day.load * ACWR_CHRONIC_LAMBDA + ewmaChronic * (1 - ACWR_CHRONIC_LAMBDA);

    // Rounded only on output — the running state keeps full precision.
    series.push({
      date,
      ...day,
      load: round2(day.load),
      atl: round2(atl),
      ctl: round2(ctl),
      tsb: round2(tsb),
      acwr: ewmaChronic > 0 ? round2(ewmaAcute / ewmaChronic) : null,
    });
  }
  return series;
}

export function buildWeekly(daily: DailyLoadPoint[], todayLocal: string, weeks = WEEKLY_HISTORY): WeeklyLoadPoint[] {
  const currentWeek = weekStartOf(todayLocal);
  const byWeek = new Map<string, number[]>();
  for (const d of daily) {
    const wk = weekStartOf(d.date);
    byWeek.set(wk, [...(byWeek.get(wk) ?? []), d.load]);
  }

  const result: WeeklyLoadPoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const weekStart = addDaysUtc(currentWeek, -7 * i);
    const loads = byWeek.get(weekStart) ?? [];
    // A partial current week is padded only up to today — future days aren't rest days.
    const padded = weekStart === currentWeek ? loads : [...loads, ...new Array(7 - loads.length).fill(0)];
    result.push({
      weekStart,
      load: padded.reduce((s, v) => s + v, 0),
      monotony: monotony(padded),
      strain: strain(padded),
      isPartialWeek: weekStart === currentWeek,
    });
  }
  return result;
}

export interface BuildTrainingLoadSummaryInput {
  inputs: LoadInput[]; // full history
  physiology: AthletePhysiology;
  todayLocal: string;
  firstActivityLocalDate: string | null;
  displayDays: number;
}

export function buildTrainingLoadSummary(input: BuildTrainingLoadSummaryInput): TrainingLoadSummary {
  const { todayLocal, displayDays } = input;
  const displayStart = addDaysUtc(todayLocal, -(displayDays - 1));
  // Start the model at the first activity so EWMAs carry real history into
  // the display window; start at the window itself when history is shorter.
  const first = input.firstActivityLocalDate;
  const modelStart = first !== null && first < displayStart ? first : displayStart;
  const full = buildDailySeries(input.inputs, modelStart, todayLocal);
  const daily = full.filter((d) => d.date >= displayStart);
  const last7 = full.slice(-7);
  const today = full[full.length - 1];
  const weekAgo = full.length > 7 ? full[full.length - 8] : null;

  const recentInputs = input.inputs.filter((a) => a.localDate > addDaysUtc(todayLocal, -7));
  const streamScored = recentInputs.filter((a) => a.source === "stream").length;
  const averageScored = recentInputs.filter((a) => a.source === "average-hr").length;
  const coveragePct =
    recentInputs.length > 0 ? Math.round(((streamScored + averageScored) / recentInputs.length) * 100) : null;
  const loads7 = last7.map((d) => d.load);

  const historyDays = first ? daysBetween(first, todayLocal) + 1 : 0;

  return {
    asOf: todayLocal,
    physiology: input.physiology,
    daily,
    weekly: buildWeekly(full, todayLocal),
    current: {
      atl: today.atl,
      ctl: today.ctl,
      tsb: today.tsb,
      acwr: today.acwr,
      band: classifyBand(today.acwr),
      rampRate: weekAgo ? today.ctl - weekAgo.ctl : today.ctl,
      load7d: loads7.reduce((s, v) => s + v, 0),
      monotony7d: monotony(loads7),
      strain7d: strain(loads7),
    },
    coverage: {
      activityCount: recentInputs.length,
      streamScored,
      averageScored,
      unscored: recentInputs.length - streamScored - averageScored,
      coveragePct,
    },
    insufficientHistory: historyDays < WARMUP_DAYS,
    // A null coveragePct means a rest week, not a data-quality problem.
    lowCoverage: (coveragePct ?? 100) < 50,
  };
}
