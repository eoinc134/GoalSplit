import type { ChangePoint, ChangePointResult, ChangePointSegment } from "@goalsplit/types";
import { median } from "./stats.js";

// Mean-shift change-point detection on a short weekly series.
//
// Exact penalised segmentation (optimal partitioning, Jackson et al. 2005 —
// the exact search PELT, Killick et al. 2012, accelerates by pruning). With
// at most ~52 weekly points the O(n²) search is instant, so pruning buys
// nothing. Segment cost is the within-segment sum of squares on the series
// standardised by a robust noise estimate; each extra change costs
// β = 3·ln(n), a conservative MBIC-style penalty — a shift has to stand out
// from week-to-week noise to be reported.

export const MIN_SEGMENT_WEEKS = 3;
const PENALTY_FACTOR = 3;
// Spike guard: each week is clipped to within this many noise SDs of a
// centred running median before segmenting.
const CLIP_SDS = 3;
const RUNNING_MEDIAN_WINDOW = 5;
// MAD → SD for normal data, and first differences have √2× the noise.
const MAD_TO_SD = 1 / 0.6745;

export interface SeriesPoint {
  date: string; // week start
  value: number;
}

// Noise SD from first differences, so the level shifts being looked for
// barely inflate it (only one difference straddles each shift).
export function robustNoiseSd(values: number[]): number | null {
  if (values.length < 3) return null;
  const diffs = values.slice(1).map((v, i) => v - values[i]);
  const center = median(diffs)!;
  const mad = median(diffs.map((d) => Math.abs(d - center)))!;
  let sd = (mad * MAD_TO_SD) / Math.SQRT2;
  if (sd === 0) {
    // Mostly-identical differences — fall back to the plain SD of the differences.
    const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
    sd = Math.sqrt(diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / diffs.length) / Math.SQRT2;
  }
  return sd > 0 ? sd : null;
}

// A one-off week (a race, a sick week, ten minutes in the HR band) would
// otherwise drag a short segment's mean and fake a shift. Genuine shifts last
// at least MIN_SEGMENT_WEEKS, so a 5-week running median follows them while
// isolated spikes get clipped.
export function clipSpikes(values: number[], noiseSd: number): number[] {
  const half = Math.floor(RUNNING_MEDIAN_WINDOW / 2);
  return values.map((v, i) => {
    const center = median(values.slice(Math.max(0, i - half), i + half + 1))!;
    return Math.max(center - CLIP_SDS * noiseSd, Math.min(center + CLIP_SDS * noiseSd, v));
  });
}

function segment(points: SeriesPoint[], from: number, to: number): ChangePointSegment {
  const slice = points.slice(from, to);
  return {
    start: slice[0].date,
    end: slice[slice.length - 1].date,
    weeks: slice.length,
    mean: slice.reduce((s, p) => s + p.value, 0) / slice.length,
  };
}

export function detectChangePoints(points: SeriesPoint[], minSegment = MIN_SEGMENT_WEEKS): ChangePointResult {
  const n = points.length;
  const noiseSd = robustNoiseSd(points.map((p) => p.value));
  const base = { noiseSd, minSegmentWeeks: minSegment };
  if (n === 0) return { ...base, segments: [], changes: [] };
  if (n < 2 * minSegment || noiseSd === null) return { ...base, segments: [segment(points, 0, n)], changes: [] };

  // Segment on, and report means of, the spike-clipped series.
  const clipped = clipSpikes(points.map((p) => p.value), noiseSd);
  points = points.map((p, i) => ({ ...p, value: clipped[i] }));
  const z = clipped.map((v) => v / noiseSd);
  const sum = [0];
  const sumSq = [0];
  for (const v of z) {
    sum.push(sum[sum.length - 1] + v);
    sumSq.push(sumSq[sumSq.length - 1] + v * v);
  }
  // Sum of squared deviations from the mean over z[s..t).
  const cost = (s: number, t: number) => sumSq[t] - sumSq[s] - (sum[t] - sum[s]) ** 2 / (t - s);

  const beta = PENALTY_FACTOR * Math.log(n);
  const best = new Array<number>(n + 1).fill(Infinity);
  const prev = new Array<number>(n + 1).fill(-1);
  best[0] = -beta;
  for (let t = minSegment; t <= n; t++) {
    for (let s = 0; s <= t - minSegment; s++) {
      if (s !== 0 && s < minSegment) continue;
      if (!Number.isFinite(best[s])) continue;
      const total = best[s] + cost(s, t) + beta;
      if (total < best[t]) {
        best[t] = total;
        prev[t] = s;
      }
    }
  }

  const bounds: number[] = [];
  for (let t = n; t > 0; t = prev[t]) bounds.unshift(t);
  const segments = bounds.map((end, i) => segment(points, i === 0 ? 0 : bounds[i - 1], end));
  const changes: ChangePoint[] = segments.slice(1).map((seg, i) => {
    const before = segments[i].mean;
    return {
      date: seg.start,
      before,
      after: seg.mean,
      changePct: before !== 0 ? ((seg.mean - before) / Math.abs(before)) * 100 : 0,
    };
  });
  return { ...base, segments, changes };
}
