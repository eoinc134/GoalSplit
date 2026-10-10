export type ActivityType = "Run" | "Ride" | "Swim" | "Walk" | "Hike" | "VirtualRun" | string;

export interface Activity {
  id: string;
  stravaId: number;
  userId: string;
  name: string;
  type: ActivityType;
  sportType: string;
  distance: number; // metres
  movingTime: number; // seconds
  elapsedTime: number; // seconds
  totalElevationGain: number; // metres
  averageSpeed: number; // m/s
  maxSpeed: number; // m/s
  averageHeartrate?: number; // bpm
  maxHeartrate?: number; // bpm
  startDate: string; // ISO 8601 UTC
  startDateLocal: string; // ISO 8601 local
  timezone: string;
  syncedAt: string;
}

export interface StravaAthlete {
  id: string;
  stravaAthleteId: number;
  username: string;
  firstname: string;
  lastname: string;
  profileUrl?: string;
}

export interface SyncStatus {
  isConnected: boolean;
  athlete?: StravaAthlete;
  lastSyncedAt?: string;
  tokenExpiresAt?: number;
}

export interface SyncResult {
  synced: number;
  pages: number;
}

export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface ApiError {
  error: string;
  statusCode: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ── Training load & performance trends ─────────────────────────────────────────

export type AcwrBand = "undertraining" | "sweet-spot" | "caution" | "high-risk";

// Inputs every HR-derived metric (TRIMP, zones, run classification) is built
// from — reported alongside results so a reader can see what was assumed.
export interface AthletePhysiology {
  hrMax: number | null; // highest HR ever recorded (Strava activities + Garmin all-day)
  hrRest: number; // median Garmin resting HR over the last 90 days, else a 60 bpm default
  hrRestSource: "garmin" | "default";
  sex: "M" | "F" | null; // from the Strava athlete profile; picks the Banister TRIMP coefficient
  trimpCoefficient: number; // 1.92 (M, also the default when unknown) or 1.67 (F)
  zoneModel: "karvonen" | "percent-max"; // karvonen once a Garmin resting HR is available
  zones: HrZoneBoundary[]; // [] when hrMax is null
}

export type LoadSource = "stream" | "average-hr" | "none";

export interface DailyLoadPoint {
  date: string; // YYYY-MM-DD, local
  load: number; // Banister TRIMP summed across the day's activities
  activityCount: number;
  scoredCount: number; // activities with any HR data (stream or average)
  atl: number; // acute training load — "fatigue", EWMA time constant 7 days
  ctl: number; // chronic training load — "fitness", EWMA time constant 42 days
  tsb: number; // training stress balance — "form", yesterday's CTL − ATL
  acwr: number | null; // EWMA acute:chronic ratio (7 vs 28 days); null while chronic is 0
}

export interface WeeklyLoadPoint {
  weekStart: string; // YYYY-MM-DD, local Monday
  load: number;
  monotony: number | null; // mean ÷ SD of the week's daily loads (Foster); null when SD is 0
  strain: number | null; // weekly load × monotony
  isPartialWeek: boolean;
}

export interface TrainingLoadSummary {
  asOf: string; // YYYY-MM-DD, local
  physiology: AthletePhysiology;
  daily: DailyLoadPoint[]; // requested display window, oldest first (computed over full history)
  weekly: WeeklyLoadPoint[]; // last 12 calendar weeks, oldest first
  current: {
    atl: number;
    ctl: number;
    tsb: number;
    acwr: number | null;
    band: AcwrBand | null;
    rampRate: number; // CTL change over the last 7 days
    load7d: number;
    monotony7d: number | null;
    strain7d: number | null;
  };
  coverage: {
    activityCount: number; // trailing 7 days
    streamScored: number;
    averageScored: number;
    unscored: number;
    coveragePct: number | null; // scored ÷ total; null when there were no activities
  };
  insufficientHistory: boolean; // fewer than 42 days since first activity — CTL still warming up
  lowCoverage: boolean; // 7-day coveragePct < 50
}

export interface WeeklyVolumePoint {
  weekStart: string; // YYYY-MM-DD, local Monday
  type: ActivityType;
  activityCount: number;
  distanceM: number;
  movingTimeS: number;
  isPartialWeek: boolean;
}

export interface WeeklyPacePoint {
  weekStart: string; // YYYY-MM-DD, local Monday
  distanceM: number;
  movingTimeS: number;
  isPartialWeek: boolean;
}

export interface PerformanceTrends {
  weeks: number;
  volumeByType: WeeklyVolumePoint[];
  runPace: WeeklyPacePoint[];
}

// ── Personal records ─────────────────────────────────────────────────────────

export type PrSource = "strava" | "manual";

export interface StravaPrCandidate {
  activityId: string;
  stravaActivityId: number;
  activityName: string;
  timeSeconds: number;
  achievedDate: string; // YYYY-MM-DD, local
}

export interface ManualPrCandidate {
  id: string;
  timeSeconds: number;
  achievedDate: string; // YYYY-MM-DD
  notes: string | null;
  sourceActivityId: string | null;
  sourceActivityName: string | null; // resolved via join; null if no link or the link is orphaned
}

export interface PrRecord {
  distanceLabel: string; // canonical case when recognized, else as-reported/entered
  isStandardDistance: boolean; // matches Strava's known best_efforts distance set
  timeSeconds: number; // the winning time
  achievedDate: string; // YYYY-MM-DD
  source: PrSource; // which side currently holds the record for this distance
  strava?: StravaPrCandidate; // present whenever Strava data exists here, win or lose
  manual?: ManualPrCandidate; // present whenever a manual entry exists here, win or lose
}

export interface ManualPrEntry {
  id: string;
  distanceLabel: string;
  timeSeconds: number;
  achievedDate: string; // YYYY-MM-DD
  notes: string | null;
  sourceActivityId: string | null;
  sourceActivityName: string | null;
  createdAt: string; // ISO 8601
}

export interface PersonalRecords {
  records: PrRecord[]; // standard-distance ladder order, then custom labels alphabetically
  manualEntries: ManualPrEntry[]; // raw manual rows, for the management/delete UI
}

// ── HR-zone analytics & aerobic decoupling ──────────────────────────────────

export interface HrZoneBoundary {
  zone: 1 | 2 | 3 | 4 | 5;
  label: string;
  minBpm: number;
  maxBpm: number | null; // null = open-ended top of Z5
}

export interface HrZoneMinutes {
  zone: 1 | 2 | 3 | 4 | 5;
  minutes: number;
}

export interface HrZoneSummary {
  windowDays: number;
  hrMaxEstimate: number | null; // highest max_heartrate ever recorded; null if never recorded
  zones: HrZoneBoundary[]; // [] when hrMaxEstimate is null
  minutesByZone: HrZoneMinutes[]; // always all 5 zones present (0 if unused); [] when hrMaxEstimate is null
  totalMinutes: number;
  activityCount: number; // activities in window, any type
  streamsCount: number; // of those, how many had a usable heartrate+time streams dump
  coveragePct: number | null; // null when activityCount is 0
  zoneModel: "karvonen" | "percent-max"; // karvonen once a Garmin resting HR is available
  restingHeartRateEstimate: number | null; // most recent known resting HR; null until Garmin is synced
}

export interface DecouplingResult {
  activityId: string;
  activityName: string;
  localDate: string; // YYYY-MM-DD
  movingTimeS: number;
  ef1: number | null; // efficiency factor (GAP m/min per bpm), first half by moving time
  ef2: number | null;
  decouplingPct: number | null; // (ef1-ef2)/ef1 * 100
  usedDistanceFallback: boolean; // true when streams lacked `distance`; summary distance prorated by time instead
}

export interface HrDriftSummary {
  windowDays: number;
  minMovingTimeS: number;
  qualifyingRunCount: number;
  streamsCount: number;
  coveragePct: number | null;
  runs: DecouplingResult[]; // most recent first
}

// ── Per-run analytics ────────────────────────────────────────────────────────

export type RunClass = "race" | "long" | "workout" | "easy" | "recovery" | "unknown";

export interface ClassifiedRun {
  activityId: string;
  activityName: string;
  localDate: string; // YYYY-MM-DD
  runClass: RunClass;
  classSource: "strava" | "inferred"; // strava = the run's own workout_type tag
  hilly: boolean; // ≥15 m elevation gain per km
}

export interface EfficiencyRun extends ClassifiedRun {
  movingTimeS: number;
  distanceM: number;
  gapPaceSecPerKm: number | null;
  avgHr: number | null;
  ef: number | null; // GAP speed (m/min) ÷ average HR
  tempAdjustedEf: number | null; // ef corrected to the sample's median temperature; null without a temp model
  avgTempC: number | null; // device-recorded — wrist sensors read warm, so treat as relative
  bandSeconds: number; // moving time spent inside the pace-at-HR band
  bandPaceSecPerKm: number | null; // GAP pace inside the band; null under 10 minutes in band
}

export interface WeeklyPaceAtHrPoint {
  weekStart: string;
  seconds: number; // moving time inside the HR band that week, all runs
  gapPaceSecPerKm: number | null;
  isPartialWeek: boolean;
}

export interface TemperatureModel {
  // OLS fit over aerobic runs: EF = b0 + b1·days + b2·tempC
  n: number;
  efPerDegC: number; // b2
  pctPerDegC: number; // b2 as a % of mean EF
  referenceTempC: number; // adjusted EF is expressed at this temperature (sample median)
  r2: number;
}

export interface EfficiencySummary {
  windowDays: number;
  band: { minBpm: number; maxBpm: number; label: string } | null; // null without HR zones
  runs: EfficiencyRun[]; // oldest first
  rollingEf: { localDate: string; ef: number; adjustedEf: number | null }[]; // 28-day rolling median, aerobic runs only
  weeklyPaceAtHr: WeeklyPaceAtHrPoint[];
  temperatureModel: TemperatureModel | null; // null below 15 runs or under 2 °C of spread
  recentMedianEf: number | null; // aerobic runs, last 28 days
  priorMedianEf: number | null; // aerobic runs, the 28 days before that
  efChangePct: number | null;
  streamsCoveragePct: number | null;
}

export interface LongRunResult extends ClassifiedRun {
  movingTimeS: number;
  distanceM: number;
  gapPaceSecPerKm: number | null;
  avgHr: number | null;
  decouplingPct: number | null; // GAP-adjusted Pa:HR, first vs second half
  paceFadePct: number | null; // last-quarter GAP pace vs first quarter; positive = slowed
  hrRiseBpm: number | null; // last-quarter avg HR minus first quarter
  weekSharePct: number | null; // share of that week's run distance
  avgTempC: number | null;
  hasStreams: boolean;
}

export interface DurabilityBin {
  label: string; // e.g. "60–90 min"
  minMinutes: number;
  maxMinutes: number | null;
  runCount: number;
  medianDecouplingPct: number | null;
  medianPaceFadePct: number | null;
}

export interface LongRunSummary {
  windowDays: number;
  definition: string; // human-readable rule, shown in the UI
  runs: LongRunResult[]; // most recent first
  durability: DurabilityBin[];
}

export type IntensityProfile = "polarized" | "pyramidal" | "threshold" | "high-intensity" | "insufficient-data";

export interface WeeklyIntensityPoint {
  weekStart: string;
  minutesByZone: HrZoneMinutes[]; // 5-zone
  lowMinutes: number; // Z1+Z2
  moderateMinutes: number; // Z3
  highMinutes: number; // Z4+Z5
  lowPct: number | null;
  polarizationIndex: number | null; // Treff et al. 2019; null when Z2 or Z3 share is 0
  profile: IntensityProfile;
  isPartialWeek: boolean;
}

export interface IntensitySummary {
  weeks: number;
  zoneModel: "karvonen" | "percent-max";
  weekly: WeeklyIntensityPoint[];
  overall: Omit<WeeklyIntensityPoint, "weekStart" | "isPartialWeek">;
  streamsCoveragePct: number | null;
}

// ── Route maps ───────────────────────────────────────────────────────────────
// Used only per-activity now (see ActivityDetail.route on the web side) — the
// all-activities overview endpoint/page was removed in favor of it.

export interface ActivityRoute {
  activityId: string;
  activityName: string;
  type: ActivityType;
  localDate: string; // YYYY-MM-DD
  points: [number, number][]; // [lat, lng]
}

// ── Garmin health data ───────────────────────────────────────────────────────
// All-day wellness metrics Strava structurally can't provide (it only sees HR
// during a recorded activity). Synced via garmy's local SQLite mirror — see
// apps/api/src/services/garmin-sync.service.ts.

export interface GarminDayPoint {
  day: string; // YYYY-MM-DD
  restingHeartRate: number | null;
  maxHeartRate: number | null;
  minHeartRate: number | null;
  averageHeartRate: number | null;
  avgStressLevel: number | null;
  maxStressLevel: number | null;
  bodyBatteryHigh: number | null;
  bodyBatteryLow: number | null;
  sleepDurationHours: number | null;
  trainingReadinessScore: number | null;
  trainingReadinessLevel: string | null;
  hrvLastNightAvg: number | null;
  hrvStatus: string | null;
  totalSteps: number | null;
}

export interface GarminDaysResponse {
  days: GarminDayPoint[]; // oldest first
}

export interface GarminSyncResult {
  synced: number;
}

// Garmin sync runs as a background job rather than inline on the HTTP request —
// a cold login + multi-day backfill can run well past Railway's edge-proxy
// timeout, which would otherwise kill the request before garmy finishes.
export interface GarminSyncStatus {
  state: "idle" | "running" | "done" | "error";
  startedAt: string | null;
  finishedAt: string | null;
  days: number | null;
  result: GarminSyncResult | null;
  error: string | null;
}
