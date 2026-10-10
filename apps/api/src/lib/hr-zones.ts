import type { HrZoneBoundary } from "@goalsplit/types";

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
// as %HRR per the standard Karvonen convention, so zoneForHeartrate needs no
// changes — it just consumes whichever boundaries array the caller picks.
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

// Below this, a first-half-vs-second-half split is too noisy to mean anything.
export const MIN_DECOUPLING_MOVING_TIME_S = 20 * 60;
