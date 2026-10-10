import type { EfficiencyRun, EfficiencySummary, HrZoneBoundary, TemperatureModel, WeeklyPaceAtHrPoint } from "@goalsplit/types";
import { averageHr, efficiencyFactor, gapPaceSecPerKm, overallSegment, paceInHrBand } from "./activity-metrics.js";
import { toClassifiedRun, weekSpine, type AnalyticsActivity } from "./analytics-activity.js";
import { addDaysUtc, daysBetween, weekStartOf } from "./dates.js";
import { isAerobicClass } from "./run-classification.js";
import { median, ols, standardDeviation } from "./stats.js";

export const MIN_EFFICIENCY_RUN_S = 20 * 60;
const MIN_BAND_S = 10 * 60;
const ROLLING_DAYS = 28;
const MIN_TEMP_MODEL_RUNS = 15;
const MIN_TEMP_SPREAD_C = 2;

export interface BuildEfficiencyInput {
  runs: AnalyticsActivity[]; // Run activities in the window, oldest first
  zones: HrZoneBoundary[];
  todayLocal: string;
  windowDays: number;
  streamsCoveragePct: number | null;
}

// EF = b0 + b1·days + b2·temp. The time term soaks up genuine fitness change
// so the temperature coefficient isn't confounded by seasons lining up with
// training blocks.
export function fitTemperatureModel(points: { day: number; tempC: number; ef: number }[]): TemperatureModel | null {
  if (points.length < MIN_TEMP_MODEL_RUNS) return null;
  const temps = points.map((p) => p.tempC);
  if ((standardDeviation(temps) ?? 0) < MIN_TEMP_SPREAD_C) return null;

  const fit = ols(points.map((p) => [p.day, p.tempC]), points.map((p) => p.ef));
  if (!fit) return null;
  const meanEf = points.reduce((s, p) => s + p.ef, 0) / points.length;
  const efPerDegC = fit.coefficients[2];
  return {
    n: points.length,
    efPerDegC,
    pctPerDegC: (efPerDegC / meanEf) * 100,
    referenceTempC: median(temps)!,
    r2: fit.r2,
  };
}

export function buildEfficiencySummary(input: BuildEfficiencyInput): EfficiencySummary {
  const { zones, todayLocal, windowDays } = input;
  const windowStart = addDaysUtc(todayLocal, -(windowDays - 1));
  const z2 = zones[1];
  const band = z2 && z2.maxBpm !== null ? { minBpm: z2.minBpm, maxBpm: z2.maxBpm, label: z2.label } : null;

  const base: EfficiencyRun[] = [];
  for (const a of input.runs) {
    if (!a.metrics?.hasHr || a.movingTimeS < MIN_EFFICIENCY_RUN_S) continue;
    const seg = overallSegment(a.metrics);
    const inBand = band ? paceInHrBand(a.metrics, band.minBpm, band.maxBpm) : { seconds: 0, gapDistanceM: 0 };
    base.push({
      ...toClassifiedRun(a, zones),
      movingTimeS: a.movingTimeS,
      distanceM: a.distanceM,
      gapPaceSecPerKm: gapPaceSecPerKm(seg),
      avgHr: averageHr(seg),
      ef: efficiencyFactor(a.metrics),
      tempAdjustedEf: null,
      avgTempC: a.metrics.avgTempC,
      bandSeconds: inBand.seconds,
      bandPaceSecPerKm:
        inBand.seconds >= MIN_BAND_S && inBand.gapDistanceM > 0 ? (inBand.seconds / inBand.gapDistanceM) * 1000 : null,
    });
  }

  const aerobic = base.filter((r) => r.ef !== null && isAerobicClass(r.runClass));
  const temperatureModel = fitTemperatureModel(
    aerobic
      .filter((r) => r.avgTempC !== null)
      .map((r) => ({ day: daysBetween(windowStart, r.localDate), tempC: r.avgTempC!, ef: r.ef! })),
  );

  const runs = base.map((r) => ({
    ...r,
    tempAdjustedEf:
      temperatureModel && r.ef !== null && r.avgTempC !== null
        ? r.ef - temperatureModel.efPerDegC * (r.avgTempC - temperatureModel.referenceTempC)
        : null,
  }));
  const aerobicRuns = runs.filter((r) => r.ef !== null && isAerobicClass(r.runClass));

  const rollingByDate = new Map<string, { localDate: string; ef: number; adjustedEf: number | null }>();
  for (const r of aerobicRuns) {
    const from = addDaysUtc(r.localDate, -(ROLLING_DAYS - 1));
    const inWindow = aerobicRuns.filter((o) => o.localDate >= from && o.localDate <= r.localDate);
    const adjusted = inWindow.filter((o) => o.tempAdjustedEf !== null).map((o) => o.tempAdjustedEf!);
    rollingByDate.set(r.localDate, {
      localDate: r.localDate,
      ef: median(inWindow.map((o) => o.ef!))!,
      adjustedEf: temperatureModel ? median(adjusted) : null,
    });
  }

  const currentWeek = weekStartOf(todayLocal);
  const weeklyPaceAtHr: WeeklyPaceAtHrPoint[] = weekSpine(windowStart, todayLocal).map((weekStart) => {
    let seconds = 0;
    let gapDistanceM = 0;
    for (const a of input.runs) {
      if (!band || !a.metrics?.hasHr || weekStartOf(a.localDate) !== weekStart) continue;
      const inBand = paceInHrBand(a.metrics, band.minBpm, band.maxBpm);
      seconds += inBand.seconds;
      gapDistanceM += inBand.gapDistanceM;
    }
    return {
      weekStart,
      seconds,
      gapPaceSecPerKm: seconds >= MIN_BAND_S && gapDistanceM > 0 ? (seconds / gapDistanceM) * 1000 : null,
      isPartialWeek: weekStart === currentWeek,
    };
  });

  const recentFrom = addDaysUtc(todayLocal, -(ROLLING_DAYS - 1));
  const priorFrom = addDaysUtc(recentFrom, -ROLLING_DAYS);
  const recentMedianEf = median(aerobicRuns.filter((r) => r.localDate >= recentFrom).map((r) => r.ef!));
  const priorMedianEf = median(
    aerobicRuns.filter((r) => r.localDate >= priorFrom && r.localDate < recentFrom).map((r) => r.ef!),
  );

  return {
    windowDays,
    band,
    runs,
    rollingEf: [...rollingByDate.values()],
    weeklyPaceAtHr,
    temperatureModel,
    recentMedianEf,
    priorMedianEf,
    efChangePct:
      recentMedianEf !== null && priorMedianEf !== null && priorMedianEf > 0
        ? ((recentMedianEf - priorMedianEf) / priorMedianEf) * 100
        : null,
    streamsCoveragePct: input.streamsCoveragePct,
  };
}
