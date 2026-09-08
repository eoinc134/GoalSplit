import type { AcwrBand, DailyLoadPoint, LoadWindowSummary, TrainingLoadSummary } from "@goalsplit/types";

export interface ActivityLoadInput {
  id: string;
  localDate: string; // YYYY-MM-DD, from (start_date_local AT TIME ZONE 'UTC')::date
}

// Latest 'list' dump payload per activity id — the only source we read `suffer_score` from.
export type ListPayloadByActivityId = Record<string, Record<string, unknown> | undefined>;

function sufferScoreOf(payload: Record<string, unknown> | undefined): number | undefined {
  // Strava omits the key entirely when it has none (no HR data) — distinct from a real 0.
  const raw = payload?.suffer_score;
  return typeof raw === "number" ? raw : undefined;
}

function addDaysUtc(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromDateStr: string, toDateStr: string): number {
  const from = new Date(`${fromDateStr}T00:00:00Z`).getTime();
  const to = new Date(`${toDateStr}T00:00:00Z`).getTime();
  return Math.round((to - from) / 86_400_000);
}

// Builds a full 28-day date spine ending on `todayLocal`, so rest days appear as
// explicit zero-load rows instead of being silently dropped by a bare GROUP BY.
export function buildLoadSpine(
  activities: ActivityLoadInput[],
  listPayloadByActivityId: ListPayloadByActivityId,
  todayLocal: string,
): DailyLoadPoint[] {
  const byDate = new Map<string, { load: number; activityCount: number; scoredCount: number }>();

  for (const act of activities) {
    const bucket = byDate.get(act.localDate) ?? { load: 0, activityCount: 0, scoredCount: 0 };
    bucket.activityCount += 1;
    const score = sufferScoreOf(listPayloadByActivityId[act.id]);
    if (score !== undefined) {
      bucket.load += score;
      bucket.scoredCount += 1;
    }
    byDate.set(act.localDate, bucket);
  }

  const spine: DailyLoadPoint[] = [];
  for (let i = 27; i >= 0; i--) {
    const date = addDaysUtc(todayLocal, -i);
    const bucket = byDate.get(date) ?? { load: 0, activityCount: 0, scoredCount: 0 };
    spine.push({ date, ...bucket });
  }
  return spine;
}

export function summarizeWindow(spine: DailyLoadPoint[], days: number): LoadWindowSummary {
  const window = spine.slice(-days);
  const totalLoad = window.reduce((sum, d) => sum + d.load, 0);
  const activityCount = window.reduce((sum, d) => sum + d.activityCount, 0);
  const scoredCount = window.reduce((sum, d) => sum + d.scoredCount, 0);

  return {
    days,
    totalLoad,
    avgLoad: totalLoad / days,
    activityCount,
    scoredCount,
    coveragePct: activityCount > 0 ? Math.round((scoredCount / activityCount) * 100) : null,
  };
}

export function computeAcwr(acute: LoadWindowSummary, chronic: LoadWindowSummary): number | null {
  return chronic.avgLoad > 0 ? acute.avgLoad / chronic.avgLoad : null;
}

export function classifyBand(acwr: number | null): AcwrBand | null {
  if (acwr === null) return null;
  if (acwr < 0.8) return "undertraining";
  if (acwr <= 1.3) return "sweet-spot";
  if (acwr <= 1.5) return "caution";
  return "high-risk";
}

export interface BuildTrainingLoadSummaryInput {
  activities: ActivityLoadInput[]; // trailing 28 local days only
  listPayloadByActivityId: ListPayloadByActivityId;
  todayLocal: string; // from Postgres CURRENT_DATE, kept consistent with the SQL query window
  firstActivityLocalDate: string | null; // MIN across all history, or null if none synced yet
}

export function buildTrainingLoadSummary(input: BuildTrainingLoadSummaryInput): TrainingLoadSummary {
  const daily = buildLoadSpine(input.activities, input.listPayloadByActivityId, input.todayLocal);
  const acute = summarizeWindow(daily, 7);
  const chronic = summarizeWindow(daily, 28);
  const acwr = computeAcwr(acute, chronic);
  const band = classifyBand(acwr);

  const historyDays = input.firstActivityLocalDate
    ? daysBetween(input.firstActivityLocalDate, input.todayLocal) + 1
    : 0;

  return {
    asOf: input.todayLocal,
    daily,
    acute,
    chronic,
    acwr,
    band,
    insufficientHistory: historyDays < 28,
    // A null coveragePct means no activities in the window at all (a rest week) —
    // that's not a data-quality problem, so it doesn't count as low coverage.
    lowCoverage: (acute.coveragePct ?? 100) < 50,
  };
}
