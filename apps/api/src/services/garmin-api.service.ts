import type { GarminDayPoint, GarminSyncResult } from "@goalsplit/types";
import { sql } from "../db/index.js";
import { addDaysUtc } from "../lib/dates.js";
import {
  DAILY_CHUNK_DAYS,
  GARMIN_API_BASE,
  SLEEP_CHUNK_DAYS,
  TOKEN_PATH,
  dateChunks,
  toGarminDayPoints,
  tokenSecondsLeft,
  type GarminDailySummary,
  type GarminHrvSummary,
  type GarminSleepSummary,
} from "../lib/garmin-api.js";

// Pulls wellness data from Garmin's official Personal API into garmin_days.
// Needs GARMIN_API (a personal API key from Garmin Connect → account settings
// → Personal API Key). Keys expire after 30 days to a year; an expired or
// revoked key surfaces as GARMIN_KEY_REJECTED.

// Renew the 24-hour token once less than this is left.
const TOKEN_RENEW_BEFORE_S = 3600;

let cachedToken: { key: string; token: string } | null = null;

export function garminConfigured(): boolean {
  return Boolean(process.env.GARMIN_API);
}

async function getToken(): Promise<string> {
  const key = process.env.GARMIN_API;
  if (!key) throw new Error("GARMIN_NOT_CONFIGURED");
  if (cachedToken?.key === key && (tokenSecondsLeft(cachedToken.token) ?? 0) > TOKEN_RENEW_BEFORE_S) {
    return cachedToken.token;
  }
  const res = await fetch(`${GARMIN_API_BASE}${TOKEN_PATH}`, {
    method: "POST",
    headers: { Authorization: `ApiKey ${key}` },
  });
  if (res.status === 401 || res.status === 403) throw new Error("GARMIN_KEY_REJECTED");
  if (!res.ok) throw new Error(`Garmin token request failed: ${res.status}`);
  // The token comes back as a bare JWT string (possibly JSON-quoted), not a JSON object.
  const token = (await res.text()).trim().replace(/^"|"$/g, "");
  cachedToken = { key, token };
  return token;
}

async function get<T>(path: string): Promise<T | null> {
  const token = await getToken();
  const res = await fetch(`${GARMIN_API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 204) return null; // e.g. HRV on a watch that doesn't record it
  if (res.status === 401) {
    cachedToken = null; // force a fresh token next time
    throw new Error("GARMIN_KEY_REJECTED");
  }
  if (!res.ok) throw new Error(`Garmin API ${res.status} for ${path.split("?")[0]}`);
  return (await res.json()) as T;
}

export async function fetchGarminDays(start: string, end: string): Promise<GarminDayPoint[]> {
  const dailies: GarminDailySummary[] = [];
  for (const [from, to] of dateChunks(start, end, DAILY_CHUNK_DAYS)) {
    const body = await get<{ data?: GarminDailySummary[] }>(
      `/usersummary-service/v2/dailysummaries?startDate=${from}&endDate=${to}`,
    );
    dailies.push(...(body?.data ?? []));
  }

  const sleeps: GarminSleepSummary[] = [];
  const hrvs: GarminHrvSummary[] = [];
  for (const [from, to] of dateChunks(start, end, SLEEP_CHUNK_DAYS)) {
    const sleep = await get<GarminSleepSummary[]>(
      `/sleep-service/sleep/dailySleepSummariesByDate?startDate=${from}&endDate=${to}`,
    );
    sleeps.push(...(Array.isArray(sleep) ? sleep : []));
    // Unverified response shape (the athlete's watch records no HRV); anything
    // unrecognised is ignored rather than failing the sync.
    const hrv = await get<{ hrvSummaries?: GarminHrvSummary[] }>(`/hrv-service/hrv/daily/${from}/${to}`);
    hrvs.push(...(Array.isArray(hrv?.hrvSummaries) ? hrv.hrvSummaries : []));
  }

  return toGarminDayPoints(dailies, sleeps, hrvs);
}

export async function upsertGarminDays(userId: string, points: GarminDayPoint[]): Promise<void> {
  for (const p of points) {
    await sql`
      INSERT INTO garmin_days (
        id, user_id, day, resting_heart_rate, max_heart_rate, min_heart_rate, average_heart_rate,
        avg_stress_level, max_stress_level, body_battery_high, body_battery_low,
        sleep_duration_hours, training_readiness_score, training_readiness_level,
        hrv_last_night_avg, hrv_status, total_steps
      ) VALUES (
        ${crypto.randomUUID()}, ${userId}, ${p.day}, ${p.restingHeartRate}, ${p.maxHeartRate},
        ${p.minHeartRate}, ${p.averageHeartRate}, ${p.avgStressLevel}, ${p.maxStressLevel},
        ${p.bodyBatteryHigh}, ${p.bodyBatteryLow}, ${p.sleepDurationHours},
        ${p.trainingReadinessScore}, ${p.trainingReadinessLevel}, ${p.hrvLastNightAvg},
        ${p.hrvStatus}, ${p.totalSteps}
      )
      ON CONFLICT (user_id, day) DO UPDATE SET
        resting_heart_rate       = EXCLUDED.resting_heart_rate,
        max_heart_rate           = EXCLUDED.max_heart_rate,
        min_heart_rate           = EXCLUDED.min_heart_rate,
        average_heart_rate       = EXCLUDED.average_heart_rate,
        avg_stress_level         = EXCLUDED.avg_stress_level,
        max_stress_level         = EXCLUDED.max_stress_level,
        body_battery_high        = EXCLUDED.body_battery_high,
        body_battery_low         = EXCLUDED.body_battery_low,
        sleep_duration_hours     = EXCLUDED.sleep_duration_hours,
        training_readiness_score = EXCLUDED.training_readiness_score,
        training_readiness_level = EXCLUDED.training_readiness_level,
        hrv_last_night_avg       = EXCLUDED.hrv_last_night_avg,
        hrv_status               = EXCLUDED.hrv_status,
        total_steps              = EXCLUDED.total_steps,
        synced_at                = NOW()
    `;
  }
}

// History counts as missing when nothing is older than this — e.g. a database
// holding only a few weeks from an earlier sync method. Checking for an empty
// table isn't enough: leftover rows would block the backfill forever.
const HISTORY_CHECK_DAYS = 60;

// The default range: everything since the first Strava activity when history
// is missing, otherwise the last week — which also re-reads recent days
// Garmin may still have been filling in.
export async function defaultSyncRange(userId: string, today: string): Promise<{ start: string; end: string }> {
  const cutoff = addDaysUtc(today, -HISTORY_CHECK_DAYS);
  const [row] = await sql<{ has_history: boolean; first_activity: string | null }[]>`
    SELECT EXISTS(SELECT 1 FROM garmin_days WHERE user_id = ${userId} AND day < ${cutoff}::date) AS has_history,
           (SELECT MIN((start_date_local AT TIME ZONE 'UTC')::date)::text FROM activities WHERE user_id = ${userId}) AS first_activity
  `;
  const backfill = !row.has_history && row.first_activity !== null;
  return { start: backfill ? row.first_activity! : addDaysUtc(today, -6), end: today };
}

export async function syncGarmin(userId: string, start: string, end: string): Promise<GarminSyncResult> {
  const points = await fetchGarminDays(start, end);
  await upsertGarminDays(userId, points);
  return { synced: points.length };
}
