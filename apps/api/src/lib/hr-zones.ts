import type { HrZoneBoundary, HrZoneMinutes, DecouplingResult } from "@goalsplit/types";

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// Highest max_heartrate ever recorded, used as a proxy for HRmax. A real
// simplification — true HRmax needs a max-effort test — surfaced as such in
// the UI, not asserted as fact.
export function estimateHrMax(maxHeartrates: number[]): number | null {
  const valid = maxHeartrates.filter((v) => isFiniteNumber(v) && v > 0);
  return valid.length > 0 ? Math.max(...valid) : null;
}

// Standard %-of-HRmax bands — a commonly cited simple 5-zone model, not a
// lab-calibrated one (that would need Strava's /athlete/zones, which needs a
// broader OAuth scope than this app currently requests).
const ZONE_PCT: { zone: 1 | 2 | 3 | 4 | 5; label: string; minPct: number }[] = [
  { zone: 1, label: "Z1 Recovery", minPct: 0 },
  { zone: 2, label: "Z2 Aerobic", minPct: 0.6 },
  { zone: 3, label: "Z3 Tempo", minPct: 0.7 },
  { zone: 4, label: "Z4 Threshold", minPct: 0.8 },
  { zone: 5, label: "Z5 Max", minPct: 0.9 },
];

export function buildZoneBoundaries(hrMax: number): HrZoneBoundary[] {
  return ZONE_PCT.map((z, i) => ({
    zone: z.zone,
    label: z.label,
    minBpm: Math.round(z.minPct * hrMax),
    maxBpm: i < ZONE_PCT.length - 1 ? Math.round(ZONE_PCT[i + 1].minPct * hrMax) - 1 : null,
  }));
}

// HRR (heart rate reserve) model — more individualized than %-of-max since it
// accounts for resting HR, not just peak. Same ZONE_PCT bands, reinterpreted
// as %HRR per the standard Karvonen convention, so zoneForHeartrate/
// bucketTimeInZone need no changes — they just consume whichever boundaries
// array the caller picks.
export function buildZoneBoundariesKarvonen(hrMax: number, hrRest: number): HrZoneBoundary[] {
  const hrr = hrMax - hrRest;
  return ZONE_PCT.map((z, i) => ({
    zone: z.zone,
    label: z.label,
    minBpm: Math.round(hrRest + z.minPct * hrr),
    maxBpm: i < ZONE_PCT.length - 1 ? Math.round(hrRest + ZONE_PCT[i + 1].minPct * hrr) - 1 : null,
  }));
}

// Last zone whose minBpm <= bpm. Never throws on out-of-range input: bpm <= 0
// falls into Z1, anything above Z5's floor is Z5.
export function zoneForHeartrate(bpm: number, boundaries: HrZoneBoundary[]): 1 | 2 | 3 | 4 | 5 {
  let zone: 1 | 2 | 3 | 4 | 5 = 1;
  for (const b of boundaries) {
    if (bpm >= b.minBpm) zone = b.zone;
  }
  return zone;
}

// Postgres JSONB comes back as `unknown`. Returns null (not []) when `raw`
// isn't an array, is empty, or has ANY non-finite-number entry — reject the
// whole series rather than filtering bad entries, since dropping entries
// would desync parallel time/heartrate/distance arrays by index.
export function parseNumberArray(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  return raw.every(isFiniteNumber) ? (raw as number[]) : null;
}

export interface TimeInZoneResult {
  minutesByZone: HrZoneMinutes[];
  totalMinutes: number;
}

// Buckets duration into HR zones: for each interval [i, i+1], the zone is
// classified by the heartrate AT THE START of the interval (not an average of
// both endpoints) — simple and defensible, documented simplification. Always
// returns all 5 zones (0-filled if unused) so a chart never silently drops a
// category.
export function bucketTimeInZone(
  timeSeconds: number[],
  heartrateBpm: number[],
  boundaries: HrZoneBoundary[],
): TimeInZoneResult {
  const secondsByZone: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const n = Math.min(timeSeconds.length, heartrateBpm.length);

  for (let i = 0; i < n - 1; i++) {
    const duration = timeSeconds[i + 1] - timeSeconds[i];
    if (!Number.isFinite(duration) || duration <= 0) continue; // non-monotonic/duplicate timestamps
    const zone = zoneForHeartrate(heartrateBpm[i], boundaries);
    secondsByZone[zone] += duration;
  }

  const minutesByZone: HrZoneMinutes[] = ZONE_PCT.map((z) => ({
    zone: z.zone,
    minutes: secondsByZone[z.zone] / 60,
  }));
  const totalMinutes = minutesByZone.reduce((sum, z) => sum + z.minutes, 0);

  return { minutesByZone, totalMinutes };
}

// Below this, a first-half-vs-second-half split is too noisy to mean anything.
export const MIN_DECOUPLING_MOVING_TIME_S = 20 * 60;

export function isEligibleForDecoupling(type: string, movingTimeS: number): boolean {
  return type === "Run" && movingTimeS >= MIN_DECOUPLING_MOVING_TIME_S;
}

export interface DecouplingInput {
  activityId: string;
  activityName: string;
  localDate: string;
  movingTimeS: number;
  summaryDistanceM: number; // flattened activities.distance — fallback source
  timeSeconds: number[];
  heartrateBpm: number[];
  distanceMeters: number[] | null; // null = streams dump had no `distance` key at all
}

const MIN_DECOUPLING_SAMPLES = 10;

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// Splits by time into two halves, computes an efficiency factor (speed/HR)
// per half, and the % change from first to second. Positive decoupling means
// HR drifted up (or pace fell) relative to the first half — expected fatigue;
// very high values suggest the effort outpaced current aerobic fitness.
export function computeAerobicDecoupling(input: DecouplingInput): DecouplingResult {
  const base = {
    activityId: input.activityId,
    activityName: input.activityName,
    localDate: input.localDate,
    movingTimeS: input.movingTimeS,
  };

  const distanceMeters = input.distanceMeters;
  const usedDistanceFallback = distanceMeters === null;
  const n = Math.min(input.timeSeconds.length, input.heartrateBpm.length, (distanceMeters ?? input.timeSeconds).length);

  if (n < MIN_DECOUPLING_SAMPLES) {
    return { ...base, ef1: null, ef2: null, decouplingPct: null, usedDistanceFallback };
  }

  const time = input.timeSeconds.slice(0, n);
  const hr = input.heartrateBpm.slice(0, n);
  // Indoor runs (e.g. treadmill) can have a heartrate stream with no GPS-derived
  // distance stream at all, even though the activity has a flattened summary
  // distance. Rather than skip these steady-state efforts entirely, synthesize
  // a constant-pace distance proxy prorated by elapsed time.
  const totalDuration = time[n - 1] - time[0];
  const distance =
    distanceMeters !== null
      ? distanceMeters.slice(0, n)
      : time.map((t) => (totalDuration > 0 ? (input.summaryDistanceM * (t - time[0])) / totalDuration : 0));

  const midTime = time[0] + totalDuration / 2;
  let splitIndex = time.findIndex((t) => t >= midTime);
  if (splitIndex < 1) splitIndex = Math.floor(n / 2);
  if (splitIndex >= n - 1) splitIndex = n - 2;

  function efficiencyFactor(from: number, to: number): number | null {
    if (to <= from) return null;
    const avgHr = mean(hr.slice(from, to + 1));
    const dt = time[to] - time[from];
    const dd = distance[to] - distance[from];
    if (avgHr <= 0 || dt <= 0) return null;
    return dd / dt / avgHr;
  }

  const ef1 = efficiencyFactor(0, splitIndex);
  const ef2 = efficiencyFactor(splitIndex + 1, n - 1);
  const decouplingPct = ef1 !== null && ef1 !== 0 && ef2 !== null ? ((ef1 - ef2) / ef1) * 100 : null;

  return { ...base, ef1, ef2, decouplingPct, usedDistanceFallback };
}
