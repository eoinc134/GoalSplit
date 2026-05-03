export type GoalStatus = "active" | "completed" | "failed" | "paused";

export type GoalType = "distance" | "time" | "pace" | "frequency" | "completion";

export type GoalCategory =
  | "running"
  | "triathlon"
  | "ultra"
  | "adventure"
  | "fitness";

export const GOAL_CATEGORY_META: Record<GoalCategory, { label: string; icon: string }> = {
  running:   { label: "Running",                icon: "🏃" },
  triathlon: { label: "Triathlon & Multi-Sport", icon: "🏊" },
  ultra:     { label: "Ultra Endurance",         icon: "⛰️" },
  adventure: { label: "Adventure",               icon: "🧗" },
  fitness:   { label: "Fitness",                 icon: "💪" },
};

export interface Goal {
  id: string;
  name: string;
  description?: string;
  category: GoalCategory;
  type: GoalType;
  targetValue: number;
  currentValue: number;
  unit: string;
  targetDate?: string; // ISO date string
  status: GoalStatus;
  prioritized?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Run {
  id: string;
  date: string; // ISO date string
  distance: number; // kilometres
  duration: number; // seconds
  pace: number; // seconds per kilometre
  elevationGain?: number; // metres
  heartRateAvg?: number; // bpm
  notes?: string;
  stravaId?: string;
  createdAt: string;
}

export interface PersonalBest {
  id: string;
  distance: number; // kilometres (e.g. 5, 10, 21.0975, 42.195)
  distanceLabel: string; // e.g. "5K", "10K", "Half Marathon", "Marathon"
  time: number; // current PB in seconds
  pace: number; // seconds per km
  goalTime?: number; // target time in seconds
  goalPace?: number; // target pace in seconds per km
  date: string; // ISO date string
  runId?: string;
  notes?: string;
}

export interface TrainingWeek {
  weekStart: string; // ISO date (Monday)
  totalDistance: number; // km
  totalDuration: number; // seconds
  runCount: number;
  runs: Run[];
}

export interface DashboardStats {
  totalRuns: number;
  totalDistance: number; // km
  totalDuration: number; // seconds
  weeklyDistance: number; // km (current week)
  activeGoals: number;
  recentRuns: Run[];
  personalBests: PersonalBest[];
}

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
