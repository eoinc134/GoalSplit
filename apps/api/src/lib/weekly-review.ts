import type {
  AthletePhysiology,
  BedtimeConsistency,
  EfficiencySummary,
  GarminDayPoint,
  LongRunResult,
  Readiness,
  RestingHrBaselinePoint,
  TrainingLoadSummary,
  WeeklyReview,
  WeeklyReviewRecovery,
  WeeklyReviewTraining,
  WeeklyReviewWeek,
} from "@goalsplit/types";
import type { AnalyticsActivity } from "./analytics-activity.js";
import { addDaysUtc, daysBetween, weekStartOf } from "./dates.js";
import { weeklyIntensity } from "./intensity.js";
import { mean, standardDeviation } from "./stats.js";

// A week-by-week digest of the Training and Recovery pages for Claude to
// write feedback from (apps/mcp-trainer `get_weekly_review`). Nothing here is
// a new metric: it slices the page builders' output into calendar weeks and
// adds Garmin weekly means. See docs/METHODS.md for every definition.

const MIN_BEDTIME_NIGHTS = 3;

export interface BuildWeeklyReviewInput {
  todayLocal: string;
  weeks: number; // 1–12; buildWeekly keeps 12 weeks of load
  physiology: AthletePhysiology;
  activities: AnalyticsActivity[]; // every type, oldest first, covering at least the window
  load: TrainingLoadSummary; // built over full history
  efficiency: EfficiencySummary; // window must cover the review window
  longRuns: LongRunResult[];
  garminDays: GarminDayPoint[]; // oldest first
  restingHr: RestingHrBaselinePoint[];
  readiness: Readiness | null;
  bedtime: BedtimeConsistency | null;
  garminLatestDay: string | null;
  lastActivityDate: string | null;
  streamsCoveragePct: number | null;
}

function round(v: number | null | undefined, digits = 1): number | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

// Minutes since noon, so 23:30 and 00:30 sit next to each other.
function bedtimeSinceNoon(sleepStartLocal: string): number {
  const [h, m] = sleepStartLocal.slice(11, 16).split(":").map(Number);
  return (h * 60 + m - 720 + 1440) % 1440;
}

export function weekRecovery(days: GarminDayPoint[], rhr: RestingHrBaselinePoint[]): WeeklyReviewRecovery {
  const withData = days.filter((d) => d.restingHeartRate !== null || d.sleepDurationHours !== null || d.bodyBatteryHigh !== null);
  const pick = (f: (d: GarminDayPoint) => number | null) => days.map(f).filter((v): v is number => v !== null);
  const deviations = rhr.map((p) => p.deviation).filter((v): v is number => v !== null);
  const bedtimes = days.filter((d) => d.sleepStartLocal).map((d) => bedtimeSinceNoon(d.sleepStartLocal!));

  let rest = 0;
  let monitored = 0;
  for (const d of days) {
    if (d.stressRestSeconds === null) continue;
    rest += d.stressRestSeconds;
    monitored += d.stressRestSeconds + (d.stressLowSeconds ?? 0) + (d.stressMediumSeconds ?? 0) + (d.stressHighSeconds ?? 0);
  }

  return {
    daysWithData: withData.length,
    restingHrMean: round(mean(pick((d) => d.restingHeartRate))),
    restingHrDeviationMean: round(mean(deviations)),
    elevatedRestingHrDays: rhr.filter((p) => p.elevated).length,
    sleepHoursMean: round(mean(pick((d) => d.sleepDurationHours)), 2),
    bedtimeSdMinutes: bedtimes.length >= MIN_BEDTIME_NIGHTS ? round(standardDeviation(bedtimes), 0) : null,
    bodyBatteryHighMean: round(mean(pick((d) => d.bodyBatteryHigh)), 0),
    restStressPct: monitored > 0 ? round((100 * rest) / monitored, 0) : null,
  };
}

export function buildWeeklyReview(input: BuildWeeklyReviewInput): WeeklyReview {
  const { todayLocal, weeks, physiology, load, efficiency } = input;
  const { weekly: intensity } = weeklyIntensity(input.activities, physiology.zones, todayLocal, weeks);
  const currentWeek = weekStartOf(todayLocal);

  const weekly: WeeklyReviewWeek[] = intensity.map((iw) => {
    const wk = iw.weekStart;
    const weekEnd = addDaysUtc(wk, 6);
    const inWeek = (day: string) => day >= wk && day <= weekEnd && day <= todayLocal;

    const acts = input.activities.filter((a) => inWeek(a.localDate));
    const runs = acts.filter((a) => a.type === "Run");
    const lw = load.weekly.find((w) => w.weekStart === wk);
    const total = iw.lowMinutes + iw.moderateMinutes + iw.highMinutes;
    const pct = (m: number) => (total > 0 ? round((100 * m) / total, 0) : null);
    const longRun =
      input.longRuns.filter((r) => inWeek(r.localDate)).sort((a, b) => b.movingTimeS - a.movingTimeS)[0] ?? null;

    const training: WeeklyReviewTraining = {
      runCount: runs.length,
      runDistanceM: Math.round(runs.reduce((s, a) => s + a.distanceM, 0)),
      activityCount: acts.length,
      movingTimeS: acts.reduce((s, a) => s + a.movingTimeS, 0),
      load: round(lw?.load ?? 0, 0) ?? 0,
      monotony: round(lw?.monotony ?? null, 2),
      strain: round(lw?.strain ?? null, 0),
      lowPct: pct(iw.lowMinutes),
      moderatePct: pct(iw.moderateMinutes),
      highPct: pct(iw.highMinutes),
      polarizationIndex: round(iw.polarizationIndex, 2),
      medianEf: round(efficiency.weeklyEf.find((w) => w.weekStart === wk)?.ef ?? null, 3),
      z2PaceSecPerKm: round(efficiency.weeklyPaceAtHr.find((w) => w.weekStart === wk)?.gapPaceSecPerKm ?? null, 0),
      longRun: longRun && {
        activityName: longRun.activityName,
        localDate: longRun.localDate,
        movingTimeS: longRun.movingTimeS,
        distanceM: Math.round(longRun.distanceM),
        decouplingPct: round(longRun.decouplingPct),
        paceFadePct: round(longRun.paceFadePct),
      },
    };

    return {
      weekStart: wk,
      isPartialWeek: wk === currentWeek,
      daysElapsed: wk === currentWeek ? daysBetween(wk, todayLocal) + 1 : 7,
      training,
      recovery: weekRecovery(
        input.garminDays.filter((d) => inWeek(d.day)),
        input.restingHr.filter((p) => inWeek(p.day)),
      ),
    };
  });

  const c = load.current;
  return {
    asOf: todayLocal,
    weeks,
    current: {
      ...c,
      atl: round(c.atl) ?? 0,
      ctl: round(c.ctl) ?? 0,
      tsb: round(c.tsb) ?? 0,
      rampRate: round(c.rampRate) ?? 0,
      load7d: round(c.load7d, 0) ?? 0,
      monotony7d: round(c.monotony7d, 2),
      strain7d: round(c.strain7d, 0),
    },
    phase: load.phases.segments.at(-1) ?? null,
    weekly,
    readiness: input.readiness,
    bedtime: input.bedtime,
    efficiency: {
      recentMedianEf: round(efficiency.recentMedianEf, 3),
      priorMedianEf: round(efficiency.priorMedianEf, 3),
      efChangePct: round(efficiency.efChangePct),
    },
    physiology: {
      hrMax: physiology.hrMax,
      hrRest: physiology.hrRest,
      hrRestSource: physiology.hrRestSource,
      zoneModel: physiology.zoneModel,
    },
    dataQuality: {
      insufficientHistory: load.insufficientHistory,
      hrCoveragePct7d: load.coverage.coveragePct,
      streamsCoveragePct: input.streamsCoveragePct,
      garminLatestDay: input.garminLatestDay,
      lastActivityDate: input.lastActivityDate,
    },
  };
}

// ── Markdown ────────────────────────────────────────────────────────────────

const DASH = "—";

function num(v: number | null | undefined, digits = 0, unit = ""): string {
  return v === null || v === undefined ? DASH : `${v.toFixed(digits)}${unit}`;
}

function signed(v: number | null | undefined, digits = 1, unit = ""): string {
  if (v === null || v === undefined) return DASH;
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}${unit}`;
}

function pace(secPerKm: number | null): string {
  if (secPerKm === null) return DASH;
  const s = Math.round(secPerKm);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}/km`;
}

function duration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h${m.toString().padStart(2, "0")}` : `${m}m`;
}

function weekLabel(w: WeeklyReviewWeek): string {
  return w.isPartialWeek ? `${w.weekStart} (${w.daysElapsed}/7 days)` : w.weekStart;
}

export function tsbReading(tsb: number): string {
  if (tsb > 0) return "fresh";
  if (tsb >= -10) return "neutral";
  if (tsb >= -30) return "productive overload";
  return "deep fatigue";
}

const BAND_LABEL: Record<string, string> = {
  undertraining: "undertraining (< 0.8)",
  "sweet-spot": "sweet spot (0.8–1.3)",
  caution: "caution (1.3–1.5)",
  "high-risk": "high risk (> 1.5)",
};

function meanOf<T>(items: T[], pick: (t: T) => number | null): number | null {
  return mean(items.map(pick).filter((v): v is number => v !== null));
}

// The last complete week against the mean of the complete weeks before it.
function comparisonLines(full: WeeklyReviewWeek[]): string[] {
  if (full.length < 2) return [];
  const last = full.at(-1)!;
  const prior = full.slice(0, -1);
  // [label, last, prior mean, digits, unit, unit for the change if different]
  const rows: [string, number | null, number | null, number, string, string?][] = [
    ["Run distance", last.training.runDistanceM / 1000, meanOf(prior, (w) => w.training.runDistanceM / 1000), 1, " km"],
    ["TRIMP", last.training.load, meanOf(prior, (w) => w.training.load), 0, ""],
    ["Low-intensity share", last.training.lowPct, meanOf(prior, (w) => w.training.lowPct), 0, "%", " pts"],
    ["Median EF", last.training.medianEf, meanOf(prior, (w) => w.training.medianEf), 3, ""],
    ["Resting HR vs baseline", last.recovery.restingHrDeviationMean, meanOf(prior, (w) => w.recovery.restingHrDeviationMean), 1, " bpm"],
    ["Sleep", last.recovery.sleepHoursMean, meanOf(prior, (w) => w.recovery.sleepHoursMean), 2, " h"],
    ["Body Battery peak", last.recovery.bodyBatteryHighMean, meanOf(prior, (w) => w.recovery.bodyBatteryHighMean), 0, ""],
  ];
  return [
    `## Last complete week (${last.weekStart}) vs the ${prior.length} before it`,
    "",
    "| Metric | Last week | Prior mean | Change |",
    "|---|---|---|---|",
    ...rows.map(
      ([label, v, p, d, u, du]) =>
        `| ${label} | ${num(v, d, u)} | ${num(p, d, u)} | ${v !== null && p !== null ? signed(v - p, d, du ?? u) : DASH} |`,
    ),
    "",
  ];
}

function caveats(r: WeeklyReview): string[] {
  const out: string[] = [];
  const cur = r.weekly.at(-1);
  if (cur?.isPartialWeek) out.push(`The current week has only ${cur.daysElapsed} of 7 days. Don't compare its totals with full weeks.`);
  if (r.dataQuality.insufficientHistory) out.push("Under 42 days of history: CTL is still warming up, so treat load figures as provisional.");
  if (r.dataQuality.hrCoveragePct7d !== null && r.dataQuality.hrCoveragePct7d < 50)
    out.push(`Only ${r.dataQuality.hrCoveragePct7d}% of the last 7 days' activities have HR, so load is understated.`);
  if (r.dataQuality.streamsCoveragePct !== null && r.dataQuality.streamsCoveragePct < 80)
    out.push(`Only ${r.dataQuality.streamsCoveragePct}% of activities in the window have streams. Intensity, EF and Z2 pace cover the rest only partly.`);
  const last = r.dataQuality.lastActivityDate;
  if (!last) out.push("There are no activities at all yet. Sync Strava first.");
  else if (r.weekly.length > 0 && last < r.weekly[0].weekStart)
    out.push(`No activities in this window. The last one was on ${last}, so the training section is empty, not a rest block, unless the athlete says so.`);
  if (!r.dataQuality.garminLatestDay) out.push("There's no Garmin data, so the recovery section is empty.");
  else if (daysBetween(r.dataQuality.garminLatestDay, r.asOf) > 2)
    out.push(`Garmin data stops at ${r.dataQuality.garminLatestDay}, so recent recovery is missing.`);
  if (r.physiology.hrRestSource === "default") out.push("Resting HR is a 60 bpm default (no Garmin), so zones and TRIMP are approximate.");
  out.push("The watch (Forerunner 55) records no HRV and no temperature, so recovery uses resting HR, sleep, stress and Body Battery only.");
  return out.map((c) => `- ${c}`);
}

export function formatWeeklyReviewMarkdown(r: WeeklyReview): string {
  const c = r.current;
  const lines: string[] = [
    `# Weekly training review, as of ${r.asOf}`,
    "",
    `${r.weekly.length} calendar weeks (Mon–Sun), oldest first. HR zones: ${r.physiology.zoneModel === "karvonen" ? "Karvonen (HR reserve)" : "% of max"}, HRmax ${num(r.physiology.hrMax)}, HRrest ${r.physiology.hrRest}${r.physiology.hrRestSource === "default" ? " (default)" : ""}.`,
    "",
    "## Right now",
    "",
    `- **Fitness (CTL)** ${num(c.ctl, 1)}, ${signed(c.rampRate)} over 7 days. **Fatigue (ATL)** ${num(c.atl, 1)}. **Form (TSB)** ${signed(c.tsb)}: ${tsbReading(c.tsb)}.`,
    `- **ACWR (EWMA)** ${num(c.acwr, 2)}${c.band ? `: ${BAND_LABEL[c.band]}` : ""}. 7-day load ${num(c.load7d)}, monotony ${num(c.monotony7d, 2)}, strain ${num(c.strain7d)}.`,
  ];
  if (r.phase) {
    lines.push(`- **Current training phase** since ${r.phase.start}: about ${num(r.phase.mean)} TRIMP/week over ${r.phase.weeks} weeks.`);
  }
  if (r.readiness) {
    const parts = r.readiness.components.map((x) => `${x.label} ${x.value.toFixed(1)}${x.unit} vs ${x.baseline.toFixed(1)} (z ${signed(x.z, 2)})`);
    const age = daysBetween(r.readiness.day, r.asOf);
    const stale = age > 2 ? `, stale: ${age} days old` : "";
    lines.push(`- **Readiness** ${r.readiness.score}/100 on ${r.readiness.day} (${r.readiness.label}${stale}; 50 = your normal): ${parts.join("; ")}.`);
  }
  const e = r.efficiency;
  if (e.recentMedianEf !== null) {
    lines.push(`- **Aerobic efficiency** median EF ${num(e.recentMedianEf, 3)} over the last 28 days vs ${num(e.priorMedianEf, 3)} in the 28 before (${signed(e.efChangePct, 1, "%")}).`);
  }
  if (r.bedtime) {
    lines.push(`- **Sleep timing** (last ${r.bedtime.nights} nights): bed at ${r.bedtime.meanBedtime}, up at ${r.bedtime.meanWake}, bedtime SD ${r.bedtime.sdMinutes} min.`);
  }

  lines.push(
    "",
    "## Training by week",
    "",
    "| Week | Runs | Run km | All time | TRIMP | Monotony | Low/Mod/High % | PI | EF | Z2 pace | Long run (decoupling, fade) |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  );
  for (const w of r.weekly) {
    const t = w.training;
    const zones = t.lowPct === null ? DASH : `${t.lowPct}/${t.moderatePct}/${t.highPct}`;
    const lr = t.longRun
      ? `${t.longRun.localDate} ${duration(t.longRun.movingTimeS)} ${(t.longRun.distanceM / 1000).toFixed(1)} km (${signed(t.longRun.decouplingPct, 1, "%")}, ${signed(t.longRun.paceFadePct, 1, "%")})`
      : DASH;
    lines.push(
      `| ${weekLabel(w)} | ${t.runCount} | ${(t.runDistanceM / 1000).toFixed(1)} | ${duration(t.movingTimeS)} | ${t.load} | ${num(t.monotony, 2)} | ${zones} | ${num(t.polarizationIndex, 2)} | ${num(t.medianEf, 3)} | ${pace(t.z2PaceSecPerKm)} | ${lr} |`,
    );
  }

  lines.push(
    "",
    "## Recovery by week (Garmin)",
    "",
    "| Week | Days | Resting HR | vs baseline | Elevated mornings | Sleep h | Bedtime SD | Body Battery peak | Rest stress % |",
    "|---|---|---|---|---|---|---|---|---|",
  );
  for (const w of r.weekly) {
    const x = w.recovery;
    lines.push(
      `| ${weekLabel(w)} | ${x.daysWithData} | ${num(x.restingHrMean, 1)} | ${signed(x.restingHrDeviationMean, 1)} | ${x.elevatedRestingHrDays} | ${num(x.sleepHoursMean, 2)} | ${num(x.bedtimeSdMinutes, 0, " min")} | ${num(x.bodyBatteryHighMean)} | ${num(x.restStressPct)} |`,
    );
  }
  lines.push("");

  lines.push(...comparisonLines(r.weekly.filter((w) => !w.isPartialWeek)));

  lines.push(
    "## How to read these",
    "",
    "- **TSB**: positive = fresh; −10 to −30 = productive overload; below −30 = deep fatigue.",
    "- **ACWR**: 0.8–1.3 is the usual target; above 1.5 means load is rising faster than fitness.",
    "- **Monotony** (weekly mean ÷ SD of daily load): above ~2 means too little variation between hard and easy days.",
    "- **Intensity**: Low = Z1–2, Mod = Z3, High = Z4–5 by HR time. Endurance training is usually ~75–80%+ low. PI > 2 with low > high > moderate = polarized.",
    "- **EF** = grade-adjusted speed (m/min) ÷ avg HR, aerobic runs ≥ 20 min. Higher = more speed per heartbeat; read it as a trend, not a single week. **Z2 pace**: faster = fitter at the same HR.",
    "- **Decoupling**: under ~5% is well coupled; over ~10% the effort outran aerobic fitness. **Fade**: last-quarter vs first-quarter GAP pace, positive = slowed.",
    "- **Resting HR vs baseline**: compared with your own rolling 28-day mean. An elevated morning (> 2 SD and ≥ 3 bpm above) is an early sign of fatigue or illness.",
    "",
    "## Data quality",
    "",
    ...caveats(r),
    "",
  );

  return lines.join("\n");
}
