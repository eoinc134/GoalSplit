export type GoalStatus = "active" | "completed" | "failed" | "paused";

export type GoalType = "distance" | "time" | "pace" | "frequency";

export interface Goal {
  id: string;
  name: string;
  description?: string;
  type: GoalType;
  targetValue: number;
  currentValue: number;
  unit: string;
  targetDate: string; // ISO date string
  status: GoalStatus;
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
  time: number; // seconds
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

// API response wrapper
export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface ApiError {
  error: string;
  statusCode: number;
}

// Pagination
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
