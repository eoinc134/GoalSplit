import type {
  AthletePhysiology,
  EfficiencySummary,
  HrDriftSummary,
  HrZoneSummary,
  IntensitySummary,
  LongRunSummary,
  PerformanceTrends,
  TrainingLoadSummary,
} from "@goalsplit/types";

// Rendered when the API is unreachable, so pages degrade to empty states.
const PHYSIOLOGY: AthletePhysiology = {
  hrMax: null,
  hrRest: 60,
  hrRestSource: "default",
  sex: null,
  trimpCoefficient: 1.92,
  zoneModel: "percent-max",
  zones: [],
};

export const LOAD_FALLBACK: TrainingLoadSummary = {
  asOf: "",
  physiology: PHYSIOLOGY,
  daily: [],
  weekly: [],
  current: { atl: 0, ctl: 0, tsb: 0, acwr: null, band: null, rampRate: 0, load7d: 0, monotony7d: null, strain7d: null },
  coverage: { activityCount: 0, streamScored: 0, averageScored: 0, unscored: 0, coveragePct: null },
  insufficientHistory: true,
  lowCoverage: false,
};

export const TRENDS_FALLBACK: PerformanceTrends = { weeks: 12, volumeByType: [], runPace: [] };

export const HR_ZONES_FALLBACK: HrZoneSummary = {
  windowDays: 28,
  hrMaxEstimate: null,
  zones: [],
  minutesByZone: [],
  totalMinutes: 0,
  activityCount: 0,
  streamsCount: 0,
  coveragePct: null,
  zoneModel: "percent-max",
  restingHeartRateEstimate: null,
};

export const HR_DRIFT_FALLBACK: HrDriftSummary = {
  windowDays: 90,
  minMovingTimeS: 1200,
  qualifyingRunCount: 0,
  streamsCount: 0,
  coveragePct: null,
  runs: [],
};

export const INTENSITY_FALLBACK: IntensitySummary = {
  weeks: 12,
  zoneModel: "percent-max",
  weekly: [],
  overall: {
    minutesByZone: [],
    lowMinutes: 0,
    moderateMinutes: 0,
    highMinutes: 0,
    lowPct: null,
    polarizationIndex: null,
    profile: "insufficient-data",
  },
  streamsCoveragePct: null,
};

export const EFFICIENCY_FALLBACK: EfficiencySummary = {
  windowDays: 180,
  band: null,
  runs: [],
  rollingEf: [],
  weeklyPaceAtHr: [],
  temperatureModel: null,
  recentMedianEf: null,
  priorMedianEf: null,
  efChangePct: null,
  streamsCoveragePct: null,
};

export const LONG_RUNS_FALLBACK: LongRunSummary = { windowDays: 365, definition: "", runs: [], durability: [] };
