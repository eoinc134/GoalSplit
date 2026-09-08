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
