import { gapFactor } from "./gap.js";
import { parseNumberArray } from "./hr-zones.js";

// Bump to recompute every stored row after changing anything below.
export const METRICS_VERSION = 1;

// [bpm, seconds, movingSeconds, distanceM, gapDistanceM]. `seconds` includes
// stopped time (HR stays elevated at a traffic light — that still counts as
// load); the moving fields only cover moving time, for pace-at-HR.
export type HrBucket = [number, number, number, number, number];

export interface Segment {
  seconds: number; // moving
  distanceM: number;
  gapDistanceM: number;
  hrSum: number; // Σ hr·dt over moving intervals that had a valid HR sample
  hrSeconds: number;
}

// Compact, model-independent summary of one activity's streams. Everything
// that depends on HRmax/HRrest/zones (TRIMP, time in zone, run class) is
// derived from the histogram at query time, so changing those inputs never
// needs a recompute — and nothing downstream has to re-read raw streams.
export interface ActivityMetrics {
  version: number;
  hasHr: boolean;
  usedDistanceFallback: boolean; // no distance stream (e.g. treadmill) — summary distance prorated by time
  gradeSource: "grade_smooth" | "altitude" | "none";
  movingSeconds: number;
  distanceM: number;
  gapDistanceM: number;
  hrHistogram: HrBucket[]; // ascending bpm
  quarters: Segment[]; // 4 equal slices of moving time
  avgTempC: number | null;
}

export interface MetricsContext {
  isRun: boolean; // GAP only applies to running; other sports get a factor of 1
  summaryDistanceM: number;
}

// Longer gaps between samples are auto-pause/recording gaps, not effort.
const MAX_INTERVAL_S = 30;
const MIN_VALID_HR = 30;
const MAX_VALID_HR = 230;
// Half-width (samples) of the altitude window used when Strava sent no grade stream.
const ALTITUDE_GRADE_HALF_WINDOW = 5;
const MIN_GRADE_RUN_M = 10;

function sameLength(arr: number[] | null, n: number): number[] | null {
  return arr && arr.length === n ? arr : null;
}

function parseBoolArray(raw: unknown, n: number): boolean[] | null {
  return Array.isArray(raw) && raw.length === n && raw.every((v) => typeof v === "boolean") ? (raw as boolean[]) : null;
}

function streamData(streams: Record<string, unknown>, key: string): unknown {
  return (streams[key] as { data?: unknown } | undefined)?.data;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function emptySegment(): Segment {
  return { seconds: 0, distanceM: 0, gapDistanceM: 0, hrSum: 0, hrSeconds: 0 };
}

function gradeFromAltitude(altitude: number[], distance: number[], i: number): number {
  const lo = Math.max(0, i - ALTITUDE_GRADE_HALF_WINDOW);
  const hi = Math.min(altitude.length - 1, i + 1 + ALTITUDE_GRADE_HALF_WINDOW);
  const run = distance[hi] - distance[lo];
  return run >= MIN_GRADE_RUN_M ? (altitude[hi] - altitude[lo]) / run : 0;
}

export function computeActivityMetrics(streams: Record<string, unknown>, ctx: MetricsContext): ActivityMetrics | null {
  const time = parseNumberArray(streamData(streams, "time"));
  if (!time || time.length < 2) return null;
  const n = time.length;

  const hr = sameLength(parseNumberArray(streamData(streams, "heartrate")), n);
  const distance = sameLength(parseNumberArray(streamData(streams, "distance")), n);
  const gradePct = sameLength(parseNumberArray(streamData(streams, "grade_smooth")), n);
  const altitude = sameLength(parseNumberArray(streamData(streams, "altitude")), n);
  const temp = sameLength(parseNumberArray(streamData(streams, "temp")), n);
  const moving = parseBoolArray(streamData(streams, "moving"), n);

  const usable = (i: number) => {
    const dt = time[i + 1] - time[i];
    return dt > 0 && dt <= MAX_INTERVAL_S;
  };
  const isMoving = (i: number) => (moving ? moving[i + 1] : true);

  // First pass: total moving time, for quarter boundaries and the no-distance fallback.
  let totalMoving = 0;
  for (let i = 0; i < n - 1; i++) {
    if (usable(i) && isMoving(i)) totalMoving += time[i + 1] - time[i];
  }
  if (totalMoving <= 0) return null;

  const fallbackSpeed = ctx.summaryDistanceM / totalMoving;
  let gradeSource: ActivityMetrics["gradeSource"] = "none";
  if (ctx.isRun && gradePct) gradeSource = "grade_smooth";
  else if (ctx.isRun && altitude && distance) gradeSource = "altitude";

  const buckets = new Map<number, HrBucket>();
  const quarters = [emptySegment(), emptySegment(), emptySegment(), emptySegment()];
  let movingSoFar = 0;
  let distanceM = 0;
  let gapDistanceM = 0;

  for (let i = 0; i < n - 1; i++) {
    if (!usable(i)) continue;
    const dt = time[i + 1] - time[i];
    const bpm = hr ? Math.round(hr[i]) : NaN;
    const hasHr = bpm >= MIN_VALID_HR && bpm <= MAX_VALID_HR;
    const bucket = hasHr ? (buckets.get(bpm) ?? [bpm, 0, 0, 0, 0]) : null;
    if (bucket) {
      bucket[1] += dt;
      buckets.set(bpm, bucket);
    }
    if (!isMoving(i)) continue;

    const dd = distance ? Math.max(0, distance[i + 1] - distance[i]) : fallbackSpeed * dt;
    let grade = 0;
    if (gradeSource === "grade_smooth") grade = gradePct![i] / 100;
    else if (gradeSource === "altitude") grade = gradeFromAltitude(altitude!, distance!, i);
    const gd = dd * gapFactor(grade);

    const q = quarters[Math.min(3, Math.floor((movingSoFar / totalMoving) * 4))];
    q.seconds += dt;
    q.distanceM += dd;
    q.gapDistanceM += gd;
    if (hasHr) {
      q.hrSum += bpm * dt;
      q.hrSeconds += dt;
    }
    if (bucket) {
      bucket[2] += dt;
      bucket[3] += dd;
      bucket[4] += gd;
    }
    movingSoFar += dt;
    distanceM += dd;
    gapDistanceM += gd;
  }

  const hrHistogram = [...buckets.values()]
    .sort((a, b) => a[0] - b[0])
    .map((b) => [b[0], round1(b[1]), round1(b[2]), round1(b[3]), round1(b[4])] as HrBucket);

  return {
    version: METRICS_VERSION,
    hasHr: hrHistogram.length > 0,
    usedDistanceFallback: distance === null,
    gradeSource,
    movingSeconds: round1(totalMoving),
    distanceM: round1(distanceM),
    gapDistanceM: round1(gapDistanceM),
    hrHistogram,
    quarters: quarters.map((q) => ({
      seconds: round1(q.seconds),
      distanceM: round1(q.distanceM),
      gapDistanceM: round1(q.gapDistanceM),
      hrSum: round1(q.hrSum),
      hrSeconds: round1(q.hrSeconds),
    })),
    avgTempC: temp ? round1(temp.reduce((s, v) => s + v, 0) / temp.length) : null,
  };
}

// ── Derived per-run figures ─────────────────────────────────────────────────

// Speed in m/min — Friel's efficiency-factor convention.
function segmentEf(seg: Segment): number | null {
  if (seg.seconds <= 0 || seg.hrSeconds <= 0) return null;
  return seg.gapDistanceM / (seg.seconds / 60) / (seg.hrSum / seg.hrSeconds);
}

function mergeSegments(a: Segment, b: Segment): Segment {
  return {
    seconds: a.seconds + b.seconds,
    distanceM: a.distanceM + b.distanceM,
    gapDistanceM: a.gapDistanceM + b.gapDistanceM,
    hrSum: a.hrSum + b.hrSum,
    hrSeconds: a.hrSeconds + b.hrSeconds,
  };
}

export function overallSegment(m: ActivityMetrics): Segment {
  return m.quarters.reduce(mergeSegments, emptySegment());
}

export function gapPaceSecPerKm(seg: Segment): number | null {
  return seg.gapDistanceM > 0 ? (seg.seconds / seg.gapDistanceM) * 1000 : null;
}

export function averageHr(seg: Segment): number | null {
  return seg.hrSeconds > 0 ? seg.hrSum / seg.hrSeconds : null;
}

export function efficiencyFactor(m: ActivityMetrics): number | null {
  return segmentEf(overallSegment(m));
}

// Friel's Pa:HR decoupling on grade-adjusted pace: positive = HR drifted up
// (or pace fell) relative to the first half.
export function decoupling(m: ActivityMetrics): { ef1: number | null; ef2: number | null; pct: number | null } {
  const ef1 = segmentEf(mergeSegments(m.quarters[0], m.quarters[1]));
  const ef2 = segmentEf(mergeSegments(m.quarters[2], m.quarters[3]));
  const pct = ef1 !== null && ef1 > 0 && ef2 !== null ? ((ef1 - ef2) / ef1) * 100 : null;
  return { ef1, ef2, pct };
}

// Last quarter vs first: positive pace fade = slower at the end.
export function quarterFade(m: ActivityMetrics): { paceFadePct: number | null; hrRiseBpm: number | null } {
  const [first, , , last] = m.quarters;
  const p1 = gapPaceSecPerKm(first);
  const p4 = gapPaceSecPerKm(last);
  const h1 = averageHr(first);
  const h4 = averageHr(last);
  return {
    paceFadePct: p1 !== null && p4 !== null ? ((p4 - p1) / p1) * 100 : null,
    hrRiseBpm: h1 !== null && h4 !== null ? h4 - h1 : null,
  };
}

// Moving time and GAP pace while HR sat inside [minBpm, maxBpm].
export function paceInHrBand(m: ActivityMetrics, minBpm: number, maxBpm: number): { seconds: number; gapDistanceM: number } {
  let seconds = 0;
  let gapDistanceM = 0;
  for (const [bpm, , movingSeconds, , gd] of m.hrHistogram) {
    if (bpm >= minBpm && bpm <= maxBpm) {
      seconds += movingSeconds;
      gapDistanceM += gd;
    }
  }
  return { seconds, gapDistanceM };
}
