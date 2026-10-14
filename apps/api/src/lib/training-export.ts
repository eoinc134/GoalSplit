import type { RunClass } from "@goalsplit/types";
import type { ActivityRow } from "../routes/activities.js";

// Latest raw Strava payloads for one activity, keyed by dump source.
// `list` is cheap and always present; `detail` (splits, best efforts,
// description, ...) is only fetched once per activity, so it may be missing
// for older activities synced before this existed, or if it was skipped
// while the Strava rate limit was tight.
export interface ActivityDumpPayloads {
  list?: Record<string, unknown>;
  detail?: Record<string, unknown>;
}

type DumpsByActivity = Record<string, ActivityDumpPayloads>;

// The app's own derived figures for an activity (see METHODS.md), so Claude
// sees the same load and pace numbers as the Training page, not Strava's
// proprietary Relative Effort.
export interface ActivityAnalysis {
  trimp: number | null; // Banister TRIMP; null without any HR data
  runClass: RunClass | null; // null for non-runs
  gapPaceSecPerKm: number | null; // null without streams
}

export type AnalysisByActivity = Record<string, ActivityAnalysis>;

const WORKOUT_TYPE_LABELS: Record<number, string> = {
  1: "race",
  2: "long run",
  3: "workout",
};

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = m.toString().padStart(2, "0");
  const ss = s.toString().padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

function formatSecondsPerKm(secondsPerKm: number): string {
  const whole = Math.round(secondsPerKm);
  return `${Math.floor(whole / 60)}:${(whole % 60).toString().padStart(2, "0")}/km`;
}

function formatPace(speedMs: number): string {
  return speedMs ? formatSecondsPerKm(1000 / speedMs) : "—";
}

type RawDump = Record<string, unknown>;

// Workout type, TRIMP, GAP and cadence — the short "headline" bits.
function buildHeaderBits(list: RawDump, analysis?: ActivityAnalysis): string[] {
  const bits: string[] = [];
  const workoutLabel = typeof list.workout_type === "number" ? WORKOUT_TYPE_LABELS[list.workout_type] : undefined;
  if (workoutLabel) bits.push(workoutLabel);
  if (analysis?.trimp != null) bits.push(`TRIMP ${Math.round(analysis.trimp)}`);
  if (analysis?.gapPaceSecPerKm != null) bits.push(`GAP ${formatSecondsPerKm(analysis.gapPaceSecPerKm)}`);
  if (typeof list.average_cadence === "number") {
    bits.push(`cadence ${Math.round(list.average_cadence * 2)}spm`);
  }
  return bits;
}

function descriptionLine(detail: RawDump): string | null {
  const description = typeof detail.description === "string" ? detail.description.trim() : "";
  return description ? `  "${description}"` : null;
}

function splitsLine(detail: RawDump): string | null {
  if (!Array.isArray(detail.splits_metric)) return null;
  const paces = detail.splits_metric
    .map((s) => (s && typeof s.average_speed === "number" ? formatPace(s.average_speed) : null))
    .filter((p): p is string => p !== null);
  return paces.length > 1 ? `  Splits: ${paces.join(", ")}` : null;
}

function bestEffortsLine(detail: RawDump): string | null {
  if (!Array.isArray(detail.best_efforts)) return null;
  const efforts = detail.best_efforts
    .map((e) =>
      e && typeof e.name === "string" && typeof e.elapsed_time === "number"
        ? `${e.name} in ${formatDuration(e.elapsed_time)}`
        : null,
    )
    .filter((e): e is string => e !== null);
  return efforts.length > 0 ? `  Best effort: ${efforts.join(", ")}` : null;
}

// Description, splits, and best efforts — the longer supporting lines.
function buildExtraLines(detail: RawDump): string[] {
  return [descriptionLine(detail), splitsLine(detail), bestEffortsLine(detail)].filter(
    (line): line is string => line !== null,
  );
}

// Builds an optional per-activity note: workout type, TRIMP, GAP, cadence,
// splits, best efforts, and any description you wrote on the activity.
// Returns null when there's nothing beyond the table row. Exported for reuse
// by the single-activity detail endpoint (activities.ts).
export function buildActivityNote(
  activity: ActivityRow,
  dumps?: ActivityDumpPayloads,
  analysis?: ActivityAnalysis,
): string | null {
  const headerBits = buildHeaderBits(dumps?.list ?? {}, analysis);
  const extraLines = buildExtraLines(dumps?.detail ?? {});

  if (headerBits.length === 0 && extraLines.length === 0) return null;

  const date = new Date(activity.start_date_local).toISOString().slice(0, 10);
  const header =
    headerBits.length > 0
      ? `${date} ${activity.name} — ${headerBits.join(", ")}`
      : `${date} ${activity.name}`;
  return [header, ...extraLines].join("\n");
}

export interface TrainingExportSummary {
  windowDays: number;
  activityCount: number;
  totalDistanceKm: number;
  totalDurationSec: number;
  avgPace: string;
  byType: Record<string, number>;
  totalTrimp?: number; // omitted when no activity in the window had HR data
}

export function buildTrainingSummary(
  activities: ActivityRow[],
  windowDays: number,
  analysis: AnalysisByActivity = {},
): TrainingExportSummary {
  const totalDistanceM = activities.reduce((sum, a) => sum + a.distance, 0);
  const totalDurationSec = activities.reduce((sum, a) => sum + a.moving_time, 0);
  const avgSpeed = totalDurationSec > 0 ? totalDistanceM / totalDurationSec : 0;

  const byType: Record<string, number> = {};
  for (const a of activities) {
    byType[a.type] = (byType[a.type] ?? 0) + 1;
  }

  const trimps = activities
    .map((a) => analysis[a.id]?.trimp)
    .filter((t): t is number => typeof t === "number");

  return {
    windowDays,
    activityCount: activities.length,
    totalDistanceKm: Math.round(totalDistanceM / 10) / 100,
    totalDurationSec,
    avgPace: formatPace(avgSpeed),
    byType,
    ...(trimps.length > 0 && { totalTrimp: Math.round(trimps.reduce((a, b) => a + b, 0)) }),
  };
}

export function buildTrainingMarkdown(
  activities: ActivityRow[],
  windowDays: number,
  dumps: DumpsByActivity = {},
  analysis: AnalysisByActivity = {},
): string {
  const summary = buildTrainingSummary(activities, windowDays, analysis);
  const lines: string[] = [];

  lines.push(
    `# Training log — last ${windowDays} days`,
    "",
    `- Activities: ${summary.activityCount}`,
    `- Total distance: ${summary.totalDistanceKm} km`,
    `- Total moving time: ${formatDuration(summary.totalDurationSec)}`,
    `- Average pace: ${summary.avgPace}`,
  );
  if (summary.totalTrimp !== undefined) {
    lines.push(`- Total training load: ${summary.totalTrimp} TRIMP (Banister, heart-rate based)`);
  }
  if (Object.keys(summary.byType).length > 0) {
    const breakdown = Object.entries(summary.byType)
      .map(([type, count]) => `${type} x${count}`)
      .join(", ");
    lines.push(`- By type: ${breakdown}`);
  }
  lines.push("");

  if (activities.length === 0) {
    lines.push("_No activities in this window._");
    return lines.join("\n");
  }

  lines.push(
    "| Date | Type | Class | Distance | Time | Pace | GAP | Elevation | Avg HR | TRIMP |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const a of activities) {
    const date = new Date(a.start_date_local).toISOString().slice(0, 10);
    const distanceKm = (a.distance / 1000).toFixed(2);
    const elevation = a.total_elevation_gain > 0 ? `${Math.round(a.total_elevation_gain)}m` : "—";
    const hr = a.average_heartrate ? `${Math.round(a.average_heartrate)} bpm` : "—";
    const an = analysis[a.id];
    const runClass = an?.runClass ?? "—";
    const gap = an?.gapPaceSecPerKm != null ? formatSecondsPerKm(an.gapPaceSecPerKm) : "—";
    const trimp = an?.trimp != null ? String(Math.round(an.trimp)) : "—";
    lines.push(
      `| ${date} | ${a.type} | ${runClass} | ${distanceKm} km | ${formatDuration(a.moving_time)} | ${formatPace(a.average_speed)} | ${gap} | ${elevation} | ${hr} | ${trimp} |`,
    );
  }

  const notes = activities
    .map((a) => buildActivityNote(a, dumps[a.id], analysis[a.id]))
    .filter((n): n is string => n !== null);

  if (notes.length > 0) {
    lines.push("", "## Notes", "");
    for (const note of notes) {
      lines.push(note, "");
    }
  }

  return lines.join("\n").trimEnd();
}
