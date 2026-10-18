import type { BacktestRow, RacePrediction, RacePredictionSummary, RoadRace } from "@goalsplit/types";
import type { AnalyticsActivity } from "./analytics-activity.js";
import { addDaysUtc } from "./dates.js";
import { median } from "./stats.js";

// Race predictions from Daniels VDOT, checked against the athlete's own history.
// Rules match research/goalsplit_research/datasets.py, where they were
// developed and backtested (see METHODS.md "Race predictions").

const STANDARD_RACES = [
  { label: "5K", distanceM: 5000 },
  { label: "10K", distanceM: 10000 },
  { label: "Half marathon", distanceM: 21097.5 },
  { label: "Marathon", distanceM: 42195 },
];
const STANDARD_TOLERANCE = 0.06; // GPS within ±6% of a standard distance counts as that race
const MAX_ROAD_RACE_M = 43_000;
const HILLY_M_PER_KM = 15; // same threshold as run classification
const RACE_EFFORT_HR_FRACTION = 0.8; // a "race" averaging under 80% of HRmax wasn't raced
const LEVEL_WINDOW_DAYS = 180;
const MIN_BACKTEST_FOR_ERROR = 3;

// Daniels & Gilbert (1979): VO2 demand of the pace ÷ fraction of VO2max
// sustainable for that duration.
export function vdot(distanceM: number, timeS: number): number {
  const t = timeS / 60;
  const v = distanceM / t;
  const vo2 = -4.6 + 0.182258 * v + 0.000104 * v * v;
  const pctMax = 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
  return vo2 / pctMax;
}

// Inverse of vdot() by bisection — VDOT falls monotonically as time rises.
export function timeForVdot(distanceM: number, target: number): number {
  let lo = 60;
  let hi = 200_000;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (vdot(distanceM, mid) > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// The distance written in the title, in metres. More reliable than GPS,
// which routinely reads courses a few percent long.
export function distanceFromName(name: string): number | null {
  const n = name.toLowerCase();
  if (/half|mezza/.test(n)) return 21097.5;
  if (/marathon|maratona/.test(n)) return 42195;
  if (/park\s?run/.test(n)) return 5000;
  const m = /\b(\d+(?:\.\d+)?)\s?k\b/.exec(n);
  return m ? Number(m[1]) * 1000 : null;
}

// An official time in brackets in the title — "(47:50)" or "(1:30:47)" —
// e.g. to correct a watch left running after the finish.
export function officialTimeFromName(name: string): number | null {
  const m = /\((\d{1,2}):(\d{2})(?::(\d{2}))?\)/.exec(name);
  if (!m) return null;
  const [a, b, c] = [Number(m[1]), Number(m[2]), m[3]];
  return c !== undefined ? a * 3600 + b * 60 + Number(c) : a * 60 + b;
}

export function raceDistance(name: string, gpsM: number): { distanceM: number; source: RoadRace["distanceSource"] } {
  const named = distanceFromName(name);
  if (named !== null) return { distanceM: named, source: "title" };
  const standard = STANDARD_RACES.find((r) => Math.abs(gpsM - r.distanceM) / r.distanceM <= STANDARD_TOLERANCE);
  return standard ? { distanceM: standard.distanceM, source: "standard" } : { distanceM: gpsM, source: "gps" };
}

// Strava-tagged races that were road races run at a genuine effort. Trail and
// ultra events are excluded: VDOT assumes flat road racing.
export function selectRoadRaces(activities: AnalyticsActivity[], hrMax: number | null): RoadRace[] {
  return activities
    .filter((a) => {
      if (a.type !== "Run" || a.workoutType !== 1 || a.distanceM > MAX_ROAD_RACE_M) return false;
      const km = a.distanceM / 1000;
      if (km > 0 && a.elevationGainM / km >= HILLY_M_PER_KM) return false;
      return a.averageHeartrate === null || hrMax === null || a.averageHeartrate >= RACE_EFFORT_HR_FRACTION * hrMax;
    })
    .map((a): RoadRace => {
      const { distanceM, source } = raceDistance(a.name, a.distanceM);
      const official = officialTimeFromName(a.name);
      const timeS = official ?? a.movingTimeS;
      return {
        activityId: a.id,
        name: a.name,
        localDate: a.localDate,
        distanceM,
        distanceSource: source,
        timeS,
        timeSource: official !== null ? "title" : "moving",
        vdot: vdot(distanceM, timeS),
      };
    })
    .sort((x, y) => x.localDate.localeCompare(y.localDate));
}

// Current level = median VDOT of road races in the window before `date` —
// median rather than best, which backtested as optimistic. With none in the
// window, the most recent race stands in, flagged stale.
export function levelBefore(races: RoadRace[], date: string): RacePredictionSummary["level"] {
  const prior = races.filter((r) => r.localDate < date);
  if (prior.length === 0) return null;
  const windowStart = addDaysUtc(date, -LEVEL_WINDOW_DAYS);
  const recent = prior.filter((r) => r.localDate >= windowStart);
  const basis = recent.length > 0 ? recent : [prior[prior.length - 1]];
  return {
    vdot: median(basis.map((r) => r.vdot))!,
    basedOn: basis.map((r) => ({ name: r.name, localDate: r.localDate, vdot: r.vdot })),
    windowDays: LEVEL_WINDOW_DAYS,
    stale: recent.length === 0,
  };
}

function distanceBand(distanceM: number): string {
  if (distanceM <= 7600) return "short";
  if (distanceM <= 15000) return "10k";
  if (distanceM <= 30000) return "half";
  return "marathon";
}

export function buildRacePredictions(races: RoadRace[], today: string): RacePredictionSummary {
  // Backtest: predict each race from only the races before it.
  const backtest: BacktestRow[] = [];
  for (const race of races) {
    const level = levelBefore(races, race.localDate);
    if (!level) continue;
    const predictedS = timeForVdot(race.distanceM, level.vdot);
    backtest.push({
      activityId: race.activityId,
      name: race.name,
      localDate: race.localDate,
      distanceM: race.distanceM,
      actualS: race.timeS,
      predictedS,
      errorPct: ((predictedS - race.timeS) / race.timeS) * 100,
    });
  }

  const level = levelBefore(races, addDaysUtc(today, 1));
  const predictions: RacePrediction[] = level
    ? STANDARD_RACES.map(({ label, distanceM }) => {
        const timeS = timeForVdot(distanceM, level.vdot);
        // How far off VDOT has been for this athlete at this distance, as a
        // mean log ratio, shrunk towards zero by n/(n+1) so one race can only
        // move the prediction halfway.
        const history = backtest.filter((b) => distanceBand(b.distanceM) === distanceBand(distanceM));
        const n = history.length;
        if (n === 0) return { label, distanceM, timeS, adjustedTimeS: null, adjustmentPct: null, historyCount: 0 };
        const meanLog = history.reduce((s, b) => s + Math.log(b.actualS / b.predictedS), 0) / n;
        const factor = Math.exp((meanLog * n) / (n + 1));
        return { label, distanceM, timeS, adjustedTimeS: timeS * factor, adjustmentPct: (factor - 1) * 100, historyCount: n };
      })
    : [];

  return {
    level,
    predictions,
    typicalErrorPct:
      backtest.length >= MIN_BACKTEST_FOR_ERROR
        ? backtest.reduce((s, b) => s + Math.abs(b.errorPct), 0) / backtest.length
        : null,
    backtest: [...backtest].reverse(),
    races: [...races].reverse(),
  };
}
