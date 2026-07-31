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

// Builds an optional per-activity note from the raw dumps: workout type, Strava's
// relative-effort score, cadence, splits, best efforts, and any description you
// wrote on the activity. Returns null when there's nothing beyond the table row.
function buildActivityNote(activity: ActivityRow, dumps?: ActivityDumpPayloads): string | null {
  const list = dumps?.list ?? {};
  const detail = dumps?.detail ?? {};

  const headerBits: string[] = [];
  if (typeof list.workout_type === "number" && WORKOUT_TYPE_LABELS[list.workout_type]) {
    headerBits.push(WORKOUT_TYPE_LABELS[list.workout_type]);
  }
  if (typeof list.suffer_score === "number") headerBits.push(`effort ${list.suffer_score}`);
  if (typeof list.average_cadence === "number") {
    headerBits.push(`cadence ${Math.round(list.average_cadence * 2)}spm`);
  }

  const extraLines: string[] = [];
  if (typeof detail.description === "string" && detail.description.trim()) {
    extraLines.push(`  "${detail.description.trim()}"`);
  }
  if (Array.isArray(detail.splits_metric)) {
    const paces = detail.splits_metric
      .map((s) => (s && typeof s.average_speed === "number" ? formatPace(s.average_speed) : null))
      .filter((p): p is string => p !== null);
    if (paces.length > 1) extraLines.push(`  Splits: ${paces.join(", ")}`);
  }
  if (Array.isArray(detail.best_efforts) && detail.best_efforts.length > 0) {
    const efforts = detail.best_efforts
      .map((e) =>
        e && typeof e.name === "string" && typeof e.elapsed_time === "number"
          ? `${e.name} in ${formatDuration(e.elapsed_time)}`
          : null,
      )
      .filter((e): e is string => e !== null);
    if (efforts.length > 0) extraLines.push(`  Best effort: ${efforts.join(", ")}`);
  }

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

  lines.push(`# Training log — last ${windowDays} days`);
  lines.push("");
  lines.push(`- Activities: ${summary.activityCount}`);
  lines.push(`- Total distance: ${summary.totalDistanceKm} km`);
  lines.push(`- Total moving time: ${formatDuration(summary.totalDurationSec)}`);
  lines.push(`- Average pace: ${summary.avgPace}`);
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

  lines.push("| Date | Type | Distance | Time | Pace | Elevation | Avg HR |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
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
    lines.push("");
    lines.push("## Notes");
    lines.push("");
    for (const note of notes) {
      lines.push(note);
      lines.push("");
    }
  }

  return lines.join("\n").trimEnd();
}
