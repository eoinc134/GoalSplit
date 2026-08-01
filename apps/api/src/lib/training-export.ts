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

function formatPace(speedMs: number): string {
  if (!speedMs) return "—";
  const secondsPerKm = 1000 / speedMs;
  const m = Math.floor(secondsPerKm / 60);
  const s = Math.round(secondsPerKm % 60);
  return `${m}:${s.toString().padStart(2, "0")}/km`;
}

type RawDump = Record<string, unknown>;

// Workout type, relative-effort score, and cadence — the short "headline" bits.
function buildHeaderBits(list: RawDump): string[] {
  const bits: string[] = [];
  const workoutLabel = typeof list.workout_type === "number" ? WORKOUT_TYPE_LABELS[list.workout_type] : undefined;
  if (workoutLabel) bits.push(workoutLabel);
  if (typeof list.suffer_score === "number") bits.push(`effort ${list.suffer_score}`);
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

// Builds an optional per-activity note from the raw dumps: workout type, Strava's
// relative-effort score, cadence, splits, best efforts, and any description you
// wrote on the activity. Returns null when there's nothing beyond the table row.
function buildActivityNote(activity: ActivityRow, dumps?: ActivityDumpPayloads): string | null {
  const headerBits = buildHeaderBits(dumps?.list ?? {});
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
  totalEffort?: number;
}

export function buildTrainingSummary(
  activities: ActivityRow[],
  windowDays: number,
  dumps: DumpsByActivity = {},
): TrainingExportSummary {
  const totalDistanceM = activities.reduce((sum, a) => sum + a.distance, 0);
  const totalDurationSec = activities.reduce((sum, a) => sum + a.moving_time, 0);
  const avgSpeed = totalDurationSec > 0 ? totalDistanceM / totalDurationSec : 0;

  const byType: Record<string, number> = {};
  for (const a of activities) {
    byType[a.type] = (byType[a.type] ?? 0) + 1;
  }

  const effortScores = activities
    .map((a) => dumps[a.id]?.list?.suffer_score)
    .filter((s): s is number => typeof s === "number");

  return {
    windowDays,
    activityCount: activities.length,
    totalDistanceKm: Math.round(totalDistanceM / 10) / 100,
    totalDurationSec,
    avgPace: formatPace(avgSpeed),
    byType,
    ...(effortScores.length > 0 && { totalEffort: effortScores.reduce((a, b) => a + b, 0) }),
  };
}

export function buildTrainingMarkdown(
  activities: ActivityRow[],
  windowDays: number,
  dumps: DumpsByActivity = {},
): string {
  const summary = buildTrainingSummary(activities, windowDays, dumps);
  const lines: string[] = [];

  lines.push(
    `# Training log — last ${windowDays} days`,
    "",
    `- Activities: ${summary.activityCount}`,
    `- Total distance: ${summary.totalDistanceKm} km`,
    `- Total moving time: ${formatDuration(summary.totalDurationSec)}`,
    `- Average pace: ${summary.avgPace}`,
  );
  if (summary.totalEffort !== undefined) {
    lines.push(`- Total relative effort (Strava): ${summary.totalEffort}`);
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
    "| Date | Type | Distance | Time | Pace | Elevation | Avg HR |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const a of activities) {
    const date = new Date(a.start_date_local).toISOString().slice(0, 10);
    const distanceKm = (a.distance / 1000).toFixed(2);
    const elevation = a.total_elevation_gain > 0 ? `${Math.round(a.total_elevation_gain)}m` : "—";
    const hr = a.average_heartrate ? `${Math.round(a.average_heartrate)} bpm` : "—";
    lines.push(
      `| ${date} | ${a.type} | ${distanceKm} km | ${formatDuration(a.moving_time)} | ${formatPace(a.average_speed)} | ${elevation} | ${hr} |`,
    );
  }

  const notes = activities
    .map((a) => buildActivityNote(a, dumps[a.id]))
    .filter((n): n is string => n !== null);

  if (notes.length > 0) {
    lines.push("", "## Notes", "");
    for (const note of notes) {
      lines.push(note, "");
    }
  }

  return lines.join("\n").trimEnd();
}
