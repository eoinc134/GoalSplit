import type postgres from "postgres";
import type { GarminDayPoint, GarminSyncResult } from "@goalsplit/types";
import { sql } from "../db/index.js";
import { addDaysUtc } from "../lib/dates.js";
import {
  DAILY_CHUNK_DAYS,
  GARMIN_MAPPING_VERSION,
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

export interface GarminRawPayloads {
  daily: GarminDailySummary[];
  sleep: GarminSleepSummary[];
  hrv: GarminHrvSummary[];
}

export async function fetchGarminPayloads(start: string, end: string): Promise<GarminRawPayloads> {
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

  return { daily: dailies, sleep: sleeps, hrv: hrvs };
}

export async function fetchGarminDays(start: string, end: string): Promise<GarminDayPoint[]> {
  const raw = await fetchGarminPayloads(start, end);
  return toGarminDayPoints(raw.daily, raw.sleep, raw.hrv);
}

// Latest raw payload per (day, source), so new metrics can be derived later
// without re-fetching history from Garmin.
export async function upsertGarminDumps(userId: string, raw: GarminRawPayloads): Promise<void> {
  const rows: { day: string; source: "daily" | "sleep" | "hrv"; payload: unknown }[] = [
    ...raw.daily.map((p) => ({ day: p.calendarDate, source: "daily" as const, payload: p })),
    ...raw.sleep.map((p) => ({ day: p.calendarDate, source: "sleep" as const, payload: p })),
    ...raw.hrv.map((p) => ({ day: p.calendarDate, source: "hrv" as const, payload: p })),
  ];
  for (const r of rows) {
    await sql`
      INSERT INTO garmin_dumps (user_id, day, source, payload, fetched_at)
      VALUES (${userId}, ${r.day}, ${r.source}, ${sql.json(r.payload as postgres.JSONValue)}, NOW())
      ON CONFLICT (user_id, day, source) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = NOW()
    `;
  }
}

export async function upsertGarminDays(userId: string, points: GarminDayPoint[]): Promise<void> {
  for (const p of points) {
    await sql`
      INSERT INTO garmin_days (
        id, user_id, day, resting_heart_rate, max_heart_rate, min_heart_rate, average_heart_rate,
        avg_stress_level, max_stress_level, body_battery_high, body_battery_low,
        sleep_duration_hours, training_readiness_score, training_readiness_level,
        hrv_last_night_avg, hrv_status, total_steps,
        deep_sleep_seconds, light_sleep_seconds, rem_sleep_seconds, awake_sleep_seconds,
        sleep_start_local, sleep_end_local, sleep_respiration_avg,
        body_battery_charged, body_battery_drained,
        stress_rest_seconds, stress_low_seconds, stress_medium_seconds, stress_high_seconds,
        mapping_version
      ) VALUES (
        ${crypto.randomUUID()}, ${userId}, ${p.day}, ${p.restingHeartRate}, ${p.maxHeartRate},
        ${p.minHeartRate}, ${p.averageHeartRate}, ${p.avgStressLevel}, ${p.maxStressLevel},
        ${p.bodyBatteryHigh}, ${p.bodyBatteryLow}, ${p.sleepDurationHours},
        ${p.trainingReadinessScore}, ${p.trainingReadinessLevel}, ${p.hrvLastNightAvg},
        ${p.hrvStatus}, ${p.totalSteps},
        ${p.deepSleepSeconds}, ${p.lightSleepSeconds}, ${p.remSleepSeconds}, ${p.awakeSleepSeconds},
        ${p.sleepStartLocal}, ${p.sleepEndLocal}, ${p.sleepRespirationAvg},
        ${p.bodyBatteryCharged}, ${p.bodyBatteryDrained},
        ${p.stressRestSeconds}, ${p.stressLowSeconds}, ${p.stressMediumSeconds}, ${p.stressHighSeconds},
        ${GARMIN_MAPPING_VERSION}
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
        deep_sleep_seconds       = EXCLUDED.deep_sleep_seconds,
        light_sleep_seconds      = EXCLUDED.light_sleep_seconds,
        rem_sleep_seconds        = EXCLUDED.rem_sleep_seconds,
        awake_sleep_seconds      = EXCLUDED.awake_sleep_seconds,
        sleep_start_local        = EXCLUDED.sleep_start_local,
        sleep_end_local          = EXCLUDED.sleep_end_local,
        sleep_respiration_avg    = EXCLUDED.sleep_respiration_avg,
        body_battery_charged     = EXCLUDED.body_battery_charged,
        body_battery_drained     = EXCLUDED.body_battery_drained,
        stress_rest_seconds      = EXCLUDED.stress_rest_seconds,
        stress_low_seconds       = EXCLUDED.stress_low_seconds,
        stress_medium_seconds    = EXCLUDED.stress_medium_seconds,
        stress_high_seconds      = EXCLUDED.stress_high_seconds,
        mapping_version          = EXCLUDED.mapping_version,
        synced_at                = NOW()
    `;
  }
}

// History counts as missing when nothing is older than this — e.g. a database
// holding only a few weeks from an earlier sync method. Checking for an empty
// table isn't enough: leftover rows would block the backfill forever.
const HISTORY_CHECK_DAYS = 60;

// The default range: everything since the first Strava activity when history
// is missing or was derived by an older GARMIN_MAPPING_VERSION, otherwise the
// last week — which also re-reads recent days Garmin may still be filling in.
export async function defaultSyncRange(userId: string, today: string): Promise<{ start: string; end: string }> {
  const cutoff = addDaysUtc(today, -HISTORY_CHECK_DAYS);
  const [row] = await sql<{ has_history: boolean; outdated: boolean; first_activity: string | null }[]>`
    SELECT EXISTS(SELECT 1 FROM garmin_days WHERE user_id = ${userId} AND day < ${cutoff}::date) AS has_history,
           EXISTS(SELECT 1 FROM garmin_days WHERE user_id = ${userId}
                    AND (mapping_version IS NULL OR mapping_version < ${GARMIN_MAPPING_VERSION})) AS outdated,
           (SELECT MIN((start_date_local AT TIME ZONE 'UTC')::date)::text FROM activities WHERE user_id = ${userId}) AS first_activity
  `;
  const backfill = (!row.has_history || row.outdated) && row.first_activity !== null;
  return { start: backfill ? row.first_activity! : addDaysUtc(today, -6), end: today };
}

export async function syncGarmin(userId: string, start: string, end: string): Promise<GarminSyncResult> {
  const raw = await fetchGarminPayloads(start, end);
  const points = toGarminDayPoints(raw.daily, raw.sleep, raw.hrv);
  await upsertGarminDumps(userId, raw);
  await upsertGarminDays(userId, points);
  return { synced: points.length };
}
