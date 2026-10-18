import type { AthletePhysiology, DailyLoadPoint, HrZoneMinutes, LoadSource, RunClass } from "@goalsplit/types";
import {
  averageHr,
  decoupling,
  efficiencyFactor,
  gapPaceSecPerKm,
  METRICS_VERSION,
  overallSegment,
  paceInHrBand,
  quarterFade,
} from "./activity-metrics.js";
import { toClassifiedRun, type AnalyticsActivity } from "./analytics-activity.js";
import { zoneMinutesFromHistogram } from "./intensity.js";
import { activityLoad } from "./trimp.js";
import { buildDailySeries } from "./training-load.js";

// Flat, full-history export of every derived metric the app computes, for the
// Python research code (research/). Python reads these rather than
// reimplementing TRIMP, GAP or run classification, so the two can't drift.

export interface ResearchActivity {
  id: string;
  name: string;
  type: string;
  localDate: string;
  movingTimeS: number;
  distanceM: number;
  elevationGainM: number;
  workoutType: number | null; // Strava's own tag: 1 race, 2 long run, 3 workout
  trimp: number;
  loadSource: LoadSource;
  hasStreams: boolean;
  // Runs only (null otherwise)
  runClass: RunClass | null;
  classSource: "strava" | "inferred" | null;
  hilly: boolean | null;
  // From streams (null without them)
  avgHr: number | null; // stream-weighted; falls back to the summary average HR
  ef: number | null; // GAP speed (m/min) ÷ avg HR
  gapPaceSecPerKm: number | null;
  decouplingPct: number | null;
  paceFadePct: number | null;
  hrRiseBpm: number | null;
  avgTempC: number | null;
  z2Seconds: number | null; // moving time inside the Z2 HR band
  z2GapDistanceM: number | null; // grade-adjusted distance covered inside it
  zoneMinutes: HrZoneMinutes[] | null; // 5-zone time, incl. stopped time
}

export interface ResearchDataset {
  generatedAt: string;
  metricsVersion: number;
  today: string;
  physiology: AthletePhysiology;
  z2Band: { minBpm: number; maxBpm: number } | null;
  daily: DailyLoadPoint[]; // first activity → today, rest days as zero
  activities: ResearchActivity[]; // oldest first
}

export function buildResearchDataset(input: {
  activities: AnalyticsActivity[];
  physiology: AthletePhysiology;
  today: string;
  firstActivityDate: string | null;
  generatedAt: string;
}): ResearchDataset {
  const { physiology } = input;
  const z2 = physiology.zones[1];
  const z2Band = z2 && z2.maxBpm !== null ? { minBpm: z2.minBpm, maxBpm: z2.maxBpm } : null;

  const activities: ResearchActivity[] = input.activities.map((a) => {
    const m = a.metrics;
    const isRun = a.type === "Run";
    const { load, source } = activityLoad(
      { histogram: m?.hrHistogram ?? null, averageHeartrate: a.averageHeartrate, movingTimeS: a.movingTimeS },
      physiology,
    );
    const classified = isRun ? toClassifiedRun(a, physiology.zones) : null;
    const seg = m ? overallSegment(m) : null;
    const band = m && z2Band ? paceInHrBand(m, z2Band.minBpm, z2Band.maxBpm) : null;
    const fade = m ? quarterFade(m) : null;

    return {
      id: a.id,
      name: a.name,
      type: a.type,
      localDate: a.localDate,
      movingTimeS: a.movingTimeS,
      distanceM: a.distanceM,
      elevationGainM: a.elevationGainM,
      workoutType: a.workoutType,
      trimp: load,
      loadSource: source,
      hasStreams: m !== null,
      runClass: classified?.runClass ?? null,
      classSource: classified?.classSource ?? null,
      hilly: classified?.hilly ?? null,
      avgHr: (seg && m?.hasHr ? averageHr(seg) : null) ?? a.averageHeartrate,
      ef: m?.hasHr ? efficiencyFactor(m) : null,
      gapPaceSecPerKm: isRun && seg ? gapPaceSecPerKm(seg) : null,
      decouplingPct: m?.hasHr ? decoupling(m).pct : null,
      paceFadePct: fade?.paceFadePct ?? null,
      hrRiseBpm: fade?.hrRiseBpm ?? null,
      avgTempC: m?.avgTempC ?? null,
      z2Seconds: band?.seconds ?? null,
      z2GapDistanceM: band?.gapDistanceM ?? null,
      zoneMinutes: m?.hasHr && physiology.zones.length > 0 ? zoneMinutesFromHistogram(m.hrHistogram, physiology.zones) : null,
    };
  });

  const daily =
    input.firstActivityDate === null
      ? []
      : buildDailySeries(
          activities.map((a) => ({ localDate: a.localDate, load: a.trimp, source: a.loadSource })),
          input.firstActivityDate,
          input.today,
        );

  return {
    generatedAt: input.generatedAt,
    metricsVersion: METRICS_VERSION,
    today: input.today,
    physiology,
    z2Band,
    daily,
    activities,
  };
}
