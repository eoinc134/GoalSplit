import type { DurabilityBin, HrZoneBoundary, LongRunResult, LongRunSummary } from "@goalsplit/types";
import { averageHr, decoupling, gapPaceSecPerKm, overallSegment, quarterFade } from "./activity-metrics.js";
import { toClassifiedRun, type AnalyticsActivity } from "./analytics-activity.js";
import { weekStartOf } from "./dates.js";
import { LONG_RUN_MIN_S } from "./run-classification.js";
import { median } from "./stats.js";

export const LONG_RUN_DEFINITION =
  "Runs of 90+ minutes, any run you tagged Long Run on Strava, or the week's longest run if it's 60+ minutes and not a workout.";

const DURABILITY_BINS: { label: string; minMinutes: number; maxMinutes: number | null }[] = [
  { label: "60–90 min", minMinutes: 60, maxMinutes: 90 },
  { label: "90–120 min", minMinutes: 90, maxMinutes: 120 },
  { label: "120–150 min", minMinutes: 120, maxMinutes: 150 },
  { label: "150+ min", minMinutes: 150, maxMinutes: null },
];

const STRAVA_LONG_RUN = 2;

// Duration and the athlete's tag always count; the week's-longest rule goes
// through classification so tempo/interval sessions are excluded.
export function isLongRunActivity(a: AnalyticsActivity, zones: HrZoneBoundary[]): boolean {
  return a.workoutType === STRAVA_LONG_RUN || a.movingTimeS >= LONG_RUN_MIN_S || toClassifiedRun(a, zones).runClass === "long";
}

export function buildDurabilityBins(runs: LongRunResult[]): DurabilityBin[] {
  return DURABILITY_BINS.map((bin) => {
    const inBin = runs.filter((r) => {
      const minutes = r.movingTimeS / 60;
      return minutes >= bin.minMinutes && (bin.maxMinutes === null || minutes < bin.maxMinutes);
    });
    return {
      ...bin,
      runCount: inBin.length,
      medianDecouplingPct: median(inBin.filter((r) => r.decouplingPct !== null).map((r) => r.decouplingPct!)),
      medianPaceFadePct: median(inBin.filter((r) => r.paceFadePct !== null).map((r) => r.paceFadePct!)),
    };
  });
}

// `runs` must hold every Run in the window (not just long ones) so each long
// run's share of its week's distance can be computed.
export function buildLongRunSummary(runs: AnalyticsActivity[], zones: HrZoneBoundary[], windowDays: number): LongRunSummary {
  const weekDistance = new Map<string, number>();
  for (const r of runs) {
    const wk = weekStartOf(r.localDate);
    weekDistance.set(wk, (weekDistance.get(wk) ?? 0) + r.distanceM);
  }

  const results: LongRunResult[] = runs
    .filter((a) => isLongRunActivity(a, zones))
    .map((a) => {
      const m = a.metrics;
      const seg = m ? overallSegment(m) : null;
      const fade = m ? quarterFade(m) : { paceFadePct: null, hrRiseBpm: null };
      const weekTotal = weekDistance.get(weekStartOf(a.localDate)) ?? 0;
      return {
        ...toClassifiedRun(a, zones),
        movingTimeS: a.movingTimeS,
        distanceM: a.distanceM,
        gapPaceSecPerKm: seg ? gapPaceSecPerKm(seg) : null,
        avgHr: seg && m?.hasHr ? averageHr(seg) : a.averageHeartrate,
        decouplingPct: m?.hasHr ? decoupling(m).pct : null,
        paceFadePct: fade.paceFadePct,
        hrRiseBpm: fade.hrRiseBpm,
        weekSharePct: weekTotal > 0 ? (a.distanceM / weekTotal) * 100 : null,
        avgTempC: m?.avgTempC ?? null,
        hasStreams: m !== null,
      };
    })
    .sort((a, b) => b.localDate.localeCompare(a.localDate));

  return { windowDays, definition: LONG_RUN_DEFINITION, runs: results, durability: buildDurabilityBins(results) };
}
