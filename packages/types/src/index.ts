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

export interface DailyLoadPoint {
  date: string; // YYYY-MM-DD, local
  load: number;
  activityCount: number;
  scoredCount: number; // how many of those activities had a suffer_score
}

export interface LoadWindowSummary {
  days: number;
  totalLoad: number;
  avgLoad: number; // per day
  activityCount: number;
  scoredCount: number;
  coveragePct: number | null; // null when activityCount is 0
}

export interface TrainingLoadSummary {
  asOf: string; // YYYY-MM-DD, local
  daily: DailyLoadPoint[]; // 28 days, oldest first
  acute: LoadWindowSummary; // trailing 7 days
  chronic: LoadWindowSummary; // trailing 28 days
  acwr: number | null; // null when chronic average load is 0
  band: AcwrBand | null;
  insufficientHistory: boolean; // fewer than 28 days since first-ever synced activity
  lowCoverage: boolean; // acute window's coveragePct < 50
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
