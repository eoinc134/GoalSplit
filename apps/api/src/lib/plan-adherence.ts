import type {
  DailyLoadPoint,
  HrZoneBoundary,
  PlanAdherence,
  PlanCriterion,
  PlanCriterionKey,
  PlanCriterionStatus,
  PlanWeek,
} from "@goalsplit/types";
import { toClassifiedRun, type AnalyticsActivity } from "./analytics-activity.js";
import { addDaysUtc, weekStartOf } from "./dates.js";
import { zoneMinutesFromHistogram } from "./intensity.js";

// Progress against research Proposal 3's pre-registered "did I follow the
// plan?" criteria (research/proposals/03-plan-before-after.md). This is a port
// of research/goalsplit_research/study.py (weekly_table, window_metrics,
// ADHERENCE) using the same inputs the research dataset endpoint feeds
// Python, so complete weeks must agree with it; scripts/check_adherence_parity.py
// checks that. The constants below are frozen with the study: don't tune them.
// The study's verdict still comes from the Python follow-up, not from here.

export const PLAN_STUDY = {
  start: "2026-11-09", // a Monday
  weeks: 13,
  proposalUrl: "https://github.com/eoinc134/GoalSplit/blob/main/research/proposals/03-plan-before-after.md",
} as const;

const LONG_RUN_MINUTES = 75;
const QUALITY_MIN_ABOVE_Z2 = 10;
const DELOAD_RANGE: [number, number] = [0.5, 0.85];
const TRAILING_WEEKS = 3;
const BUILD_FIRST_WEEKS = 4;
const BUILD_FROM_WEEK = 6;
const BREAK_DAYS = 14;
const ADHERENT_MIN = 6;
const TARGETS = { deloads: 2, long_runs: 10, quality: 9, easy: 80, build: 1.1 } as const;
const GAP_WARNING_DAYS = 7;

const LABELS: Record<PlanCriterionKey, string> = {
  no_break: "No 14+ day break",
  no_collapse: "No week under 50% of the previous 3 weeks' km",
  deloads: "At least 2 deload weeks (50–85% of the previous 3 weeks' km)",
  long_runs: "Weekend 75+ min run in at least 10 of 13 weeks",
  quality: "Quality session in at least 9 of 13 weeks",
  easy: "At least 80% of heart-rate time in Z1–2",
  build: "Best later 4 weeks at least 10% above the first 4 (km)",
};

export interface BuildPlanAdherenceInput {
  activities: AnalyticsActivity[]; // every type, oldest first, from at least 3 weeks before the start
  daily: DailyLoadPoint[]; // daily series covering the study window up to today
  zones: HrZoneBoundary[];
  todayLocal: string;
  study?: { start: string; weeks: number; proposalUrl: string };
}

interface WeekAgg {
  weekStart: string;
  km: number;
  load: number;
  weekendLongRun: boolean;
  quality: boolean;
  zone: number[]; // 5-zone minutes, all activity types
}

function isWeekend(localDate: string): boolean {
  const dow = new Date(`${localDate}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

function isQuality(a: AnalyticsActivity, zones: HrZoneBoundary[]): boolean {
  const { runClass } = toClassifiedRun(a, zones);
  if (runClass !== "workout" && runClass !== "race") return false;
  if (!a.metrics?.hasHr || zones.length === 0) return true; // no heart rate: trust the class
  const minutes = zoneMinutesFromHistogram(a.metrics.hrHistogram, zones);
  return minutes.slice(2).reduce((s, z) => s + z.minutes, 0) >= QUALITY_MIN_ABOVE_Z2;
}

function aggregateWeeks(input: BuildPlanAdherenceInput, firstWeek: string, lastWeek: string): WeekAgg[] {
  const byWeek = new Map<string, WeekAgg>();
  for (let wk = firstWeek; wk <= lastWeek; wk = addDaysUtc(wk, 7)) {
    byWeek.set(wk, { weekStart: wk, km: 0, load: 0, weekendLongRun: false, quality: false, zone: [0, 0, 0, 0, 0] });
  }
  for (const a of input.activities) {
    const w = byWeek.get(weekStartOf(a.localDate));
    if (!w || a.localDate > input.todayLocal) continue;
    if (a.metrics?.hasHr && input.zones.length > 0) {
      zoneMinutesFromHistogram(a.metrics.hrHistogram, input.zones).forEach((z, i) => (w.zone[i] += z.minutes));
    }
    if (a.type !== "Run") continue;
    w.km += a.distanceM / 1000;
    if (isWeekend(a.localDate) && a.movingTimeS >= LONG_RUN_MINUTES * 60) w.weekendLongRun = true;
    if (isQuality(a, input.zones)) w.quality = true;
  }
  for (const d of input.daily) {
    const w = byWeek.get(weekStartOf(d.date));
    if (w && d.date <= input.todayLocal) w.load += d.load;
  }
  return [...byWeek.values()];
}

// Gaps of inactive days within [from, to]: their lengths, and the gap still
// open at `to` (0 when `to` was active).
function gaps(daily: DailyLoadPoint[], from: string, to: string): { lengths: number[]; current: number } {
  const activeDays = new Set(daily.filter((d) => d.activityCount > 0).map((d) => d.date));
  const lengths: number[] = [];
  let run = 0;
  for (let day = from; day <= to; day = addDaysUtc(day, 1)) {
    if (activeDays.has(day)) {
      if (run > 0) lengths.push(run);
      run = 0;
    } else run++;
  }
  if (run > 0) lengths.push(run);
  return { lengths, current: run };
}

function mean(values: number[]): number | null {
  return values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// A "k of n weeks" criterion: `done` weeks have it, `open` weeks could still.
// `slackPhrase`: how room to spare is put, e.g. "can miss 2 more weeks" for
// weeks the athlete wants every week, "12 weeks left" for occasional ones.
function countStatus(
  done: number,
  open: number,
  target: number,
  finished: boolean,
  slackPhrase: (slack: number, open: number) => string = (slack) => `can miss ${plural(slack, "more week")}`,
): { status: PlanCriterionStatus; detail: string } {
  if (done >= target) return { status: "met", detail: `${done} of ${target} needed — done` };
  const slack = done + open - target;
  if (finished || slack < 0) return { status: "missed", detail: `${done} of ${target} needed — no longer reachable` };
  if (slack === 0) return { status: "at-risk", detail: `${done} of ${target} needed — every remaining week needs one` };
  return { status: "on-track", detail: `${done} of ${target} needed — ${slackPhrase(slack, open)}` };
}

export function buildPlanAdherence(input: BuildPlanAdherenceInput): PlanAdherence {
  const study = input.study ?? PLAN_STUDY;
  const today = input.todayLocal;
  const end = addDaysUtc(study.start, study.weeks * 7 - 1);
  let status: PlanAdherence["status"] = "in-progress";
  if (today < study.start) status = "not-started";
  else if (today > end) status = "finished";
  const finished = status === "finished";
  const evalTo = finished ? end : today; // last day that counts
  const currentWeek = weekStartOf(today);

  const lastStudyWeek = addDaysUtc(study.start, (study.weeks - 1) * 7);
  const all = aggregateWeeks(input, addDaysUtc(study.start, -7 * TRAILING_WEEKS), lastStudyWeek);
  const studyAggs = all.slice(TRAILING_WEEKS);

  const weeks: PlanWeek[] = studyAggs.map((w, i) => {
    let state: PlanWeek["state"] = "future";
    if (finished || w.weekStart < currentWeek) state = "complete";
    else if (w.weekStart === currentWeek) state = "current";
    const trailing = mean(all.slice(i, i + TRAILING_WEEKS).map((t) => t.km));
    const ratio = state === "complete" && trailing !== null && trailing > 0 ? w.km / trailing : null;
    let kind: PlanWeek["kind"] = null;
    if (ratio !== null && ratio < DELOAD_RANGE[0]) kind = "collapse";
    else if (ratio !== null) kind = ratio <= DELOAD_RANGE[1] ? "deload" : "normal";
    const totalZone = w.zone.reduce((s, v) => s + v, 0);
    return {
      weekStart: w.weekStart,
      weekNumber: i + 1,
      state,
      km: Math.round(w.km * 10) / 10,
      load: Math.round(w.load),
      kmVsTrailing: ratio === null ? null : Math.round(ratio * 100) / 100,
      kind,
      weekendLongRun: w.weekendLongRun,
      quality: w.quality,
      lowPct: totalZone > 0 ? Math.round(((w.zone[0] + w.zone[1]) / totalZone) * 100) : null,
    };
  });

  const weekNumber = status === "in-progress" ? weeks.find((w) => w.state === "current")!.weekNumber : null;
  const complete = weeks.filter((w) => w.state === "complete");
  const openWeeks = (has: (w: PlanWeek) => boolean) => weeks.filter((w) => w.state !== "complete" && !has(w)).length;
  const doneWeeks = (has: (w: PlanWeek) => boolean) => weeks.filter((w) => w.state !== "future" && has(w)).length;

  const criteria: PlanCriterion[] = [];
  const add = (key: PlanCriterionKey, value: number | null, target: number, s: { status: PlanCriterionStatus; detail: string }) =>
    criteria.push({ key, label: LABELS[key], value, target, ...s });

  if (status === "not-started") {
    for (const key of Object.keys(LABELS) as PlanCriterionKey[]) {
      add(key, null, key in TARGETS ? TARGETS[key as keyof typeof TARGETS] : 0, { status: "pending", detail: `Study starts ${study.start}` });
    }
    return {
      study: { start: study.start, end, weeks: study.weeks, proposalUrl: study.proposalUrl },
      asOf: today,
      weekNumber,
      status,
      criteria,
      metOrOnTrack: 0,
      requiredMin: ADHERENT_MIN,
      onTrack: false,
      currentGapDays: gaps(input.daily, addDaysUtc(today, -60), today).current,
      weeks,
    };
  }

  // No 14+ day break (a gap still open today counts at its current length).
  const g = gaps(input.daily, study.start, evalTo);
  const breaks = g.lengths.filter((n) => n >= BREAK_DAYS).length;
  if (breaks > 0) add("no_break", breaks, 0, { status: "missed", detail: `${plural(breaks, "break")} of 14+ days` });
  else if (finished) add("no_break", 0, 0, { status: "met", detail: "No 14+ day break" });
  else if (g.current >= GAP_WARNING_DAYS)
    add("no_break", 0, 0, { status: "at-risk", detail: `${plural(g.current, "day")} since the last activity — a break at ${BREAK_DAYS}` });
  else add("no_break", 0, 0, { status: "on-track", detail: g.current > 0 ? `Last activity ${plural(g.current, "day")} ago` : "Active today" });

  const collapses = complete.filter((w) => w.kind === "collapse").length;
  add(
    "no_collapse",
    collapses,
    0,
    collapses > 0
      ? { status: "missed", detail: `${plural(collapses, "week")} under 50%` }
      : { status: finished ? "met" : "on-track", detail: "No week under 50% so far" },
  );

  // A deload can only be recognised once its week is complete.
  const deloads = complete.filter((w) => w.kind === "deload").length;
  add("deloads", deloads, TARGETS.deloads, countStatus(deloads, study.weeks - complete.length, TARGETS.deloads, finished, (_, open) => `${plural(open, "week")} left`));

  const longDone = doneWeeks((w) => w.weekendLongRun);
  add("long_runs", longDone, TARGETS.long_runs, countStatus(longDone, openWeeks((w) => w.weekendLongRun), TARGETS.long_runs, finished));

  const qualityDone = doneWeeks((w) => w.quality);
  add("quality", qualityDone, TARGETS.quality, countStatus(qualityDone, openWeeks((w) => w.quality), TARGETS.quality, finished));

  // Low share over the whole window so far, all activity types (as study.py).
  const zone = [0, 0, 0, 0, 0];
  studyAggs.forEach((w) => w.zone.forEach((m, i) => (zone[i] += m)));
  const zoneTotal = zone.reduce((s, v) => s + v, 0);
  const lowPct = zoneTotal > 0 ? Math.round(((zone[0] + zone[1]) / zoneTotal) * 1000) / 10 : null;
  if (lowPct === null) add("easy", null, TARGETS.easy, { status: "pending", detail: "No heart-rate data yet" });
  else if (lowPct >= TARGETS.easy) add("easy", lowPct, TARGETS.easy, { status: finished ? "met" : "on-track", detail: `${lowPct}% low so far` });
  else add("easy", lowPct, TARGETS.easy, { status: finished ? "missed" : "at-risk", detail: `${lowPct}% low so far — needs 80%` });

  // Build: the best 4-week mean from week 6 on vs the first 4 weeks, complete weeks only.
  const kms = complete.map((w) => w.km);
  const first = kms.length >= BUILD_FIRST_WEEKS ? mean(kms.slice(0, BUILD_FIRST_WEEKS))! : null;
  const later: number[] = [];
  for (let i = BUILD_FROM_WEEK - 1; i + BUILD_FIRST_WEEKS <= kms.length; i++) later.push(mean(kms.slice(i, i + BUILD_FIRST_WEEKS))!);
  if (first === null) {
    add("build", null, TARGETS.build, { status: "pending", detail: `Measured from the first 4 weeks (${complete.length} of 4 complete)` });
  } else if (first <= 0) {
    add("build", null, TARGETS.build, { status: finished ? "missed" : "pending", detail: "No km in the first 4 weeks" });
  } else if (later.length === 0) {
    const need = Math.round(first * TARGETS.build * 10) / 10;
    add("build", null, TARGETS.build, {
      status: "pending",
      detail: `First 4 weeks averaged ${first.toFixed(1)} km — a 4-week stretch from week 6 needs ${need} km/week (first check after week 9)`,
    });
  } else {
    const ratio = Math.max(...later) / first;
    const r = Math.round(ratio * 100) / 100;
    if (ratio >= TARGETS.build) add("build", r, TARGETS.build, { status: "met", detail: `Best stretch ${r}× the first 4 weeks` });
    else add("build", r, TARGETS.build, { status: finished ? "missed" : "at-risk", detail: `Best stretch so far ${r}× — needs 1.1×` });
  }

  const ok = criteria.filter((c) => c.status === "met" || c.status === "on-track").length;
  const stillPossible = criteria.filter((c) => c.status !== "missed").length;
  const noBreak = criteria.find((c) => c.key === "no_break")!;
  return {
    study: { start: study.start, end, weeks: study.weeks, proposalUrl: study.proposalUrl },
    asOf: today,
    weekNumber,
    status,
    criteria,
    metOrOnTrack: ok,
    requiredMin: ADHERENT_MIN,
    // Finished: the study's own rule. In progress: still achievable (pending
    // and at-risk criteria haven't failed yet).
    onTrack: noBreak.status !== "missed" && (finished ? ok : stillPossible) >= ADHERENT_MIN,
    currentGapDays: g.current,
    weeks,
  };
}

// Plain-text rendering for Claude (MCP `get_plan_adherence`).
export function formatPlanAdherenceMarkdown(p: PlanAdherence): string {
  const mark = (b: boolean) => (b ? "✓" : "·");
  const STATE_TEXT = { "in-progress": `Now in week ${p.weekNumber}.`, finished: "Finished.", "not-started": "Not started yet." };
  const lines = [
    `# Training-plan adherence (Proposal 3), as of ${p.asOf}`,
    "",
    `Study ${p.study.start} to ${p.study.end} (${p.study.weeks} weeks). ${STATE_TEXT[p.status]} Followed = at least ${p.requiredMin} of 7 criteria, with no 14+ day break required.`,
    `**${p.metOrOnTrack} of 7 met or on track. ${p.onTrack ? "Adherence is still achievable." : "Adherence can no longer be reached."}**`,
    "",
    "| Criterion | Status | Detail |",
    "|---|---|---|",
    ...p.criteria.map((c) => `| ${c.label} | ${c.status} | ${c.detail} |`),
    "",
    "| Week | Start | km | vs trailing 3 | Kind | Weekend 75+ | Quality | Low % |",
    "|---|---|---|---|---|---|---|---|",
    ...p.weeks
      .filter((w) => w.state !== "future")
      .map(
        (w) =>
          `| ${w.weekNumber}${w.state === "current" ? " (current)" : ""} | ${w.weekStart} | ${w.km} | ${w.kmVsTrailing ?? "—"} | ${w.kind ?? "—"} | ${mark(w.weekendLongRun)} | ${mark(w.quality)} | ${w.lowPct ?? "—"} |`,
      ),
    "",
    "This tracks the plan; it isn't the plan. The study's verdict comes from the Python follow-up after the window closes. Report adherence; don't redesign the plan.",
    "",
  ];
  return lines.join("\n");
}
