import type { ActivityRow } from "../routes/activities.js";

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

export interface TrainingExportSummary {
  windowDays: number;
  activityCount: number;
  totalDistanceKm: number;
  totalDurationSec: number;
  avgPace: string;
  byType: Record<string, number>;
}

export function buildTrainingSummary(activities: ActivityRow[], windowDays: number): TrainingExportSummary {
  const totalDistanceM = activities.reduce((sum, a) => sum + a.distance, 0);
  const totalDurationSec = activities.reduce((sum, a) => sum + a.moving_time, 0);
  const avgSpeed = totalDurationSec > 0 ? totalDistanceM / totalDurationSec : 0;

  const byType: Record<string, number> = {};
  for (const a of activities) {
    byType[a.type] = (byType[a.type] ?? 0) + 1;
  }

  return {
    windowDays,
    activityCount: activities.length,
    totalDistanceKm: Math.round(totalDistanceM / 10) / 100,
    totalDurationSec,
    avgPace: formatPace(avgSpeed),
    byType,
  };
}

export function buildTrainingMarkdown(activities: ActivityRow[], windowDays: number): string {
  const summary = buildTrainingSummary(activities, windowDays);
  const lines: string[] = [];

  lines.push(`# Training log — last ${windowDays} days`);
  lines.push("");
  lines.push(`- Activities: ${summary.activityCount}`);
  lines.push(`- Total distance: ${summary.totalDistanceKm} km`);
  lines.push(`- Total moving time: ${formatDuration(summary.totalDurationSec)}`);
  lines.push(`- Average pace: ${summary.avgPace}`);
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
      `| ${date} | ${a.type} | ${distanceKm} km | ${formatDuration(a.moving_time)} | ${formatPace(a.average_speed)} | ${elevation} | ${hr} |`
    );
  }

  return lines.join("\n");
}
