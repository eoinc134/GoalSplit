import type { WeeklyReview } from "@goalsplit/types";
import { addDaysUtc, weekStartOf } from "../lib/dates.js";
import { buildEfficiencySummary } from "../lib/efficiency.js";
import { buildLongRunSummary } from "../lib/long-runs.js";
import { bedtimeConsistency, readiness, restingHrBaseline } from "../lib/recovery.js";
import { buildDailySeries, buildTrainingLoadSummary, type LoadInput } from "../lib/training-load.js";
import { activityLoad } from "../lib/trimp.js";
import { buildWeeklyReview } from "../lib/weekly-review.js";
import { getPhysiology, loadAnalyticsActivities, streamsCoveragePct } from "./analytics-data.service.js";
import { loadGarminDays } from "./recovery.service.js";

// Same windows as the pages: load over full history, efficiency over a year
// of runs (so its 28-vs-28-day EF comparison matches the Training page).
const EFFICIENCY_DAYS = 365;
const LOAD_DISPLAY_DAYS = 90;

export async function getWeeklyReview(userId: string, weeks: number): Promise<WeeklyReview> {
  const [physiology, loaded, garminDays] = await Promise.all([
    getPhysiology(userId),
    loadAnalyticsActivities(userId),
    loadGarminDays(userId),
  ]);
  const today = loaded.today;

  const inputs: LoadInput[] = loaded.activities.map((a) => ({
    localDate: a.localDate,
    ...activityLoad(
      { histogram: a.metrics?.hrHistogram ?? null, averageHeartrate: a.averageHeartrate, movingTimeS: a.movingTimeS },
      physiology,
    ),
  }));
  const load = buildTrainingLoadSummary({
    inputs,
    physiology,
    todayLocal: today,
    firstActivityLocalDate: loaded.firstActivityDate,
    displayDays: LOAD_DISPLAY_DAYS,
  });

  const windowStart = addDaysUtc(weekStartOf(today), -7 * (weeks - 1));
  const efficiencyStart = addDaysUtc(today, -(EFFICIENCY_DAYS - 1));
  const runs = loaded.activities.filter((a) => a.type === "Run");
  const efficiency = buildEfficiencySummary({
    runs: runs.filter((a) => a.localDate >= efficiencyStart),
    zones: physiology.zones,
    todayLocal: today,
    windowDays: EFFICIENCY_DAYS,
    streamsCoveragePct: null,
  });
  const windowActivities = loaded.activities.filter((a) => a.localDate >= windowStart);
  const windowRuns = runs.filter((a) => a.localDate >= windowStart);
  const longRuns = buildLongRunSummary(windowRuns, physiology.zones, weeks * 7).runs;

  const rhr = restingHrBaseline(garminDays);
  // Readiness's form baseline wants full history, as on the Recovery page.
  const daily = loaded.firstActivityDate ? buildDailySeries(inputs, loaded.firstActivityDate, today) : [];

  return buildWeeklyReview({
    todayLocal: today,
    weeks,
    physiology,
    activities: windowActivities,
    load,
    efficiency,
    longRuns,
    garminDays,
    restingHr: rhr,
    readiness: readiness(garminDays, rhr, daily),
    bedtime: bedtimeConsistency(garminDays, today),
    garminLatestDay: garminDays.at(-1)?.day ?? null,
    lastActivityDate: loaded.activities.at(-1)?.localDate ?? null,
    streamsCoveragePct: streamsCoveragePct(windowActivities),
  });
}
