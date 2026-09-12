import type { ManualPrEntry, PrRecord, StravaPrCandidate } from "@goalsplit/types";

// Strava's best_efforts distance names, shortest to longest — used only for
// display casing and sort order, never to reject data. An unrecognized label
// still surfaces correctly as a custom (non-standard) row.
export const CANONICAL_DISTANCE_LADDER = [
  "400m",
  "1/2 mile",
  "1K",
  "1 mile",
  "2 mile",
  "5K",
  "10K",
  "15K",
  "10 mile",
  "20K",
  "Half-Marathon",
  "30K",
  "Marathon",
] as const;

const LADDER_INDEX_BY_KEY = new Map(CANONICAL_DISTANCE_LADDER.map((label, i) => [normalizeDistanceKey(label), i]));

// Collapses whitespace/hyphen variance ("Half-Marathon" / "Half Marathon" /
// "half  marathon") so Strava-vs-manual comparison isn't defeated by formatting.
export function normalizeDistanceKey(label: string): string {
  return label.trim().toLowerCase().replace(/[\s-]+/g, " ");
}

export interface DetailDumpRow {
  activity_id: string;
  strava_id: number;
  name: string;
  local_date: string; // YYYY-MM-DD
  best_efforts: unknown; // raw JSONB — payload -> 'best_efforts', may be absent/malformed
}

interface RawBestEffort {
  name?: unknown;
  elapsed_time?: unknown;
}

// Same defensive posture as training-export.ts's bestEffortsLine(): payload is
// untyped JSON, only trust entries with the expected shape. A zero/negative
// elapsed_time is rejected outright — a corrupt value must never "win" a PR.
export function extractBestEfforts(row: DetailDumpRow): StravaPrCandidate[] {
  if (!Array.isArray(row.best_efforts)) return [];

  return (row.best_efforts as RawBestEffort[])
    .filter(
      (e): e is { name: string; elapsed_time: number } =>
        !!e && typeof e.name === "string" && typeof e.elapsed_time === "number" && e.elapsed_time > 0,
    )
    .map((e) => ({
      activityId: row.activity_id,
      stravaActivityId: row.strava_id,
      activityName: row.name,
      timeSeconds: e.elapsed_time,
      achievedDate: row.local_date,
      // rawLabel carries the exact string Strava reported, for display when unrecognized.
      rawLabel: e.name,
    }));
}

interface StravaBest extends StravaPrCandidate {
  rawLabel: string;
}

// One current-best candidate per normalized distance key, recomputed fresh
// from raw elapsed_time values every call. pr_rank is never read anywhere in
// this file — that's the entire self-healing mechanism: as soon as a faster
// run's detail dump exists, the next call reflects it, no migration needed.
export function computeStravaBests(rows: DetailDumpRow[]): Map<string, StravaBest> {
  const best = new Map<string, StravaBest>();
  for (const row of rows) {
    for (const candidate of extractBestEfforts(row) as StravaBest[]) {
      const key = normalizeDistanceKey(candidate.rawLabel);
      const existing = best.get(key);
      if (!existing || candidate.timeSeconds < existing.timeSeconds) best.set(key, candidate);
    }
  }
  return best;
}

export interface ManualPrRow {
  id: string;
  distance_label: string;
  time_seconds: number;
  achieved_date: string; // YYYY-MM-DD
  notes: string | null;
  source_activity_id: string | null;
  source_activity_name: string | null;
  created_at: string;
}

export function toManualPrEntry(row: ManualPrRow): ManualPrEntry {
  return {
    id: row.id,
    distanceLabel: row.distance_label,
    timeSeconds: row.time_seconds,
    achievedDate: row.achieved_date,
    notes: row.notes,
    sourceActivityId: row.source_activity_id,
    sourceActivityName: row.source_activity_name,
    createdAt: row.created_at,
  };
}

function distanceLabelFor(key: string, fallback: string): string {
  const ladderIndex = LADDER_INDEX_BY_KEY.get(key);
  return ladderIndex !== undefined ? CANONICAL_DISTANCE_LADDER[ladderIndex] : fallback;
}

function sortRecords(records: PrRecord[]): PrRecord[] {
  return [...records].sort((a, b) => {
    const aIdx = LADDER_INDEX_BY_KEY.get(normalizeDistanceKey(a.distanceLabel));
    const bIdx = LADDER_INDEX_BY_KEY.get(normalizeDistanceKey(b.distanceLabel));
    if (aIdx !== undefined && bIdx !== undefined) return aIdx - bIdx;
    if (aIdx !== undefined) return -1; // standard distances first
    if (bIdx !== undefined) return 1;
    return a.distanceLabel.localeCompare(b.distanceLabel); // customs: alphabetical
  });
}

// Merges Strava-derived bests with manual entries, per distance key: the
// faster time wins. Both candidates are embedded on the resulting record
// whenever either exists (win or lose), so the UI can show e.g. "Strava 19:32
// (beat manual 20:10)" from one row without a second lookup.
export function buildPrRecords(
  stravaBests: Map<string, StravaBest>,
  manualEntries: ManualPrEntry[],
): PrRecord[] {
  const manualBestByKey = new Map<string, ManualPrEntry>();
  for (const entry of manualEntries) {
    const key = normalizeDistanceKey(entry.distanceLabel);
    const existing = manualBestByKey.get(key);
    if (!existing || entry.timeSeconds < existing.timeSeconds) manualBestByKey.set(key, entry);
  }

  const keys = new Set([...stravaBests.keys(), ...manualBestByKey.keys()]);
  const records: PrRecord[] = [];

  for (const key of keys) {
    const strava = stravaBests.get(key);
    const manual = manualBestByKey.get(key);
    const stravaWins = !!strava && (!manual || strava.timeSeconds <= manual.timeSeconds);
    const winner = stravaWins ? strava! : manual!;
    const fallbackLabel = stravaWins ? strava!.rawLabel : manual!.distanceLabel;

    records.push({
      distanceLabel: distanceLabelFor(key, fallbackLabel),
      isStandardDistance: LADDER_INDEX_BY_KEY.has(key),
      timeSeconds: winner.timeSeconds,
      achievedDate: winner.achievedDate,
      source: stravaWins ? "strava" : "manual",
      ...(strava && {
        strava: {
          activityId: strava.activityId,
          stravaActivityId: strava.stravaActivityId,
          activityName: strava.activityName,
          timeSeconds: strava.timeSeconds,
          achievedDate: strava.achievedDate,
        },
      }),
      ...(manual && {
        manual: {
          id: manual.id,
          timeSeconds: manual.timeSeconds,
          achievedDate: manual.achievedDate,
          notes: manual.notes,
          sourceActivityId: manual.sourceActivityId,
          sourceActivityName: manual.sourceActivityName,
        },
      }),
    });
  }

  return sortRecords(records);
}

export interface ManualPrInput {
  distanceLabel: string;
  timeSeconds: number;
  achievedDate: string;
  notes?: string | null;
  sourceActivityId?: string | null;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

// Pure validator, independent of Express — existence/ownership of
// sourceActivityId requires a DB lookup, so that's checked in the route.
export function validateManualPrInput(body: unknown): ValidationResult {
  if (!body || typeof body !== "object") return { valid: false, error: "Invalid request body" };
  const b = body as Record<string, unknown>;

  if (typeof b.distanceLabel !== "string" || b.distanceLabel.trim().length === 0 || b.distanceLabel.length > 60) {
    return { valid: false, error: "distanceLabel must be 1-60 characters" };
  }

  if (!Number.isInteger(b.timeSeconds) || (b.timeSeconds as number) <= 0 || (b.timeSeconds as number) > 172_800) {
    return { valid: false, error: "timeSeconds must be a positive integer of at most 172800 (48h)" };
  }

  if (typeof b.achievedDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.achievedDate)) {
    return { valid: false, error: "achievedDate must be in YYYY-MM-DD format" };
  }
  const parsed = new Date(`${b.achievedDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return { valid: false, error: "achievedDate is not a valid calendar date" };
  }
  const todayStr = new Date().toISOString().slice(0, 10);
  if (b.achievedDate > todayStr) {
    return { valid: false, error: "achievedDate cannot be in the future" };
  }

  if (b.notes !== undefined && b.notes !== null && (typeof b.notes !== "string" || b.notes.length > 200)) {
    return { valid: false, error: "notes must be a string of at most 200 characters" };
  }

  if (
    b.sourceActivityId !== undefined &&
    b.sourceActivityId !== null &&
    typeof b.sourceActivityId !== "string"
  ) {
    return { valid: false, error: "sourceActivityId must be a string" };
  }

  return { valid: true };
}
