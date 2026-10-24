import type { GarminDayPoint } from "@goalsplit/types";
import { addDaysUtc, daysBetween } from "./dates.js";

// Garmin Connect Personal API (official, free personal tier, launched Oct 2026).
// A personal API key is exchanged for a 24-hour bearer token; data endpoints
// mirror Garmin Connect's own service paths. Ranges per request, measured
// against the live API: daily summaries accept a year (400+ days is rejected),
// sleep summaries 4 weeks (90 days is rejected).
export const GARMIN_API_BASE = "https://personal.connectapi.garmin.com";
export const TOKEN_PATH = "/personalapitoken-service/personal-api/personal-api-key/token";
export const DAILY_CHUNK_DAYS = 90;
export const SLEEP_CHUNK_DAYS = 28;

// [start, end] date pairs (inclusive) covering the range in chunks.
export function dateChunks(start: string, end: string, chunkDays: number): [string, string][] {
  const chunks: [string, string][] = [];
  for (let from = start; from <= end; from = addDaysUtc(from, chunkDays)) {
    const to = addDaysUtc(from, chunkDays - 1);
    chunks.push([from, to < end ? to : end]);
  }
  return chunks;
}

export function rangeDays(start: string, end: string): number {
  return daysBetween(start, end) + 1;
}

// Seconds until the JWT's `exp` claim; null when it can't be read.
export function tokenSecondsLeft(token: string, nowMs = Date.now()): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: number };
    return typeof claims.exp === "number" ? claims.exp - nowMs / 1000 : null;
  } catch {
    return null;
  }
}

// Shapes of the response fields we read — everything else is ignored.
export interface GarminDailySummary {
  calendarDate: string;
  includesWellnessData?: boolean;
  movement?: { steps?: { value?: number } };
  heartRate?: { minValue?: number; maxValue?: number; restingValue?: number };
  stress?: { avgLevel?: number; maxLevel?: number; totalDurationInMillis?: number };
  bodyBattery?: { minValue?: number; maxValue?: number };
}

export interface GarminSleepSummary {
  calendarDate: string;
  sleepTimeSeconds?: number | null;
}

export interface GarminHrvSummary {
  calendarDate: string;
  lastNightAvg?: number | null;
  status?: string | null;
}

// Garmin reports a "resting" HR even on days the watch was barely worn, e.g.
// 148 bpm on a day whose minimum was 101, from 1.5 hours of wear around a run.
// A real resting HR needs enough wear to include rest, can't sit far above the
// day's minimum, and is physiologically bounded. Resting HR feeds the Karvonen
// zones and TRIMP, so implausible values are dropped at ingestion.
export const MIN_WEAR_HOURS_FOR_RESTING = 12;
export const MAX_RESTING_ABOVE_MIN = 10;
export const MAX_PLAUSIBLE_RESTING = 100;

export function plausibleRestingHr(d: GarminDailySummary): number | null {
  const resting = d.heartRate?.restingValue;
  const min = d.heartRate?.minValue;
  const wearHours = (d.stress?.totalDurationInMillis ?? 0) / 3_600_000;
  if (typeof resting !== "number" || resting <= 0) return null;
  if (wearHours < MIN_WEAR_HOURS_FOR_RESTING) return null;
  if (typeof min === "number" && resting > min + MAX_RESTING_ABOVE_MIN) return null;
  return resting <= MAX_PLAUSIBLE_RESTING ? resting : null;
}

// Garmin uses negative values (−1, −2) for "not enough data" in stress fields.
function nonNegative(v: number | undefined | null): number | null {
  return typeof v === "number" && v >= 0 ? v : null;
}

export function toGarminDayPoints(
  dailies: GarminDailySummary[],
  sleeps: GarminSleepSummary[],
  hrvs: GarminHrvSummary[] = [],
): GarminDayPoint[] {
  const sleepByDay = new Map(sleeps.map((s) => [s.calendarDate, s]));
  const hrvByDay = new Map(hrvs.map((h) => [h.calendarDate, h]));
  const days = new Set([...dailies.map((d) => d.calendarDate), ...sleepByDay.keys()]);
  const dailyByDay = new Map(dailies.map((d) => [d.calendarDate, d]));

  const points: GarminDayPoint[] = [];
  for (const day of [...days].sort()) {
    const d = dailyByDay.get(day);
    const wellness = d?.includesWellnessData ? d : undefined; // watch not worn → no wellness numbers
    const sleepSeconds = sleepByDay.get(day)?.sleepTimeSeconds;
    const hrv = hrvByDay.get(day);
    const point: GarminDayPoint = {
      day,
      restingHeartRate: wellness ? plausibleRestingHr(wellness) : null,
      maxHeartRate: nonNegative(wellness?.heartRate?.maxValue),
      minHeartRate: nonNegative(wellness?.heartRate?.minValue),
      averageHeartRate: null, // not in the Personal API's daily summary
      avgStressLevel: nonNegative(wellness?.stress?.avgLevel),
      maxStressLevel: nonNegative(wellness?.stress?.maxLevel),
      bodyBatteryHigh: nonNegative(wellness?.bodyBattery?.maxValue),
      bodyBatteryLow: nonNegative(wellness?.bodyBattery?.minValue),
      sleepDurationHours: typeof sleepSeconds === "number" && sleepSeconds > 0 ? sleepSeconds / 3600 : null,
      trainingReadinessScore: null, // not in the Personal API's documented endpoints
      trainingReadinessLevel: null,
      hrvLastNightAvg: nonNegative(hrv?.lastNightAvg),
      hrvStatus: hrv?.status ?? null,
      totalSteps: nonNegative(wellness?.movement?.steps?.value),
    };
    const hasAny = Object.entries(point).some(([k, v]) => k !== "day" && v !== null);
    if (hasAny) points.push(point);
  }
  return points;
}
