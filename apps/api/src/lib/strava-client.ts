import { fetchWithRetry } from "./http.js";
import { log } from "./logger.js";

const STRAVA_API = "https://www.strava.com/api/v3";
const STRAVA_AUTH_URL = "https://www.strava.com/oauth/token";

export interface StravaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete: StravaAthleteResponse;
}

export interface StravaRefreshResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export interface StravaAthleteResponse {
  id: number;
  username: string;
  firstname: string;
  lastname: string;
  profile: string;
  city?: string;
  country?: string;
  sex?: "M" | "F" | null;
}

export interface StravaActivityResponse {
  id: number;
  name: string;
  type: string;
  sport_type: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  average_speed: number;
  max_speed: number;
  average_heartrate?: number;
  max_heartrate?: number;
  start_date: string;
  start_date_local: string;
  timezone: string;
}

// The detailed representation (GET /activities/{id}) carries many more fields
// than the list endpoint (splits, laps, best_efforts, description, gear, ...)
// and Strava adds fields over time — we store it as-is rather than typing every key.
export type StravaActivityDetail = Record<string, unknown>;

// All stream types Strava's activity-streams endpoint can return. Requesting a
// type an activity doesn't have (e.g. `watts` with no power meter) just omits
// that key from the response rather than erroring.
export const STREAM_KEYS = [
  "time",
  "distance",
  "latlng",
  "altitude",
  "velocity_smooth",
  "heartrate",
  "cadence",
  "watts",
  "temp",
  "moving",
  "grade_smooth",
] as const;

// Response shape with key_by_type=true: an object keyed by stream type, each
// holding { data, series_type, original_size, resolution }. Stored as-is, same
// rationale as StravaActivityDetail — only present keys are the ones Strava has.
export type StravaStreamSet = Record<string, unknown>;

// Strava rejected our credentials: a refused refresh token, or a 401 on an
// API call (access revoked from the athlete's Strava settings). Reconnecting
// via OAuth is the only fix. Strava's response body is logged, never put in
// the message, since messages can reach API clients.
export class StravaAuthError extends Error {
  constructor(context: string, status: number) {
    super(`${context}: Strava returned ${status}`);
    this.name = "StravaAuthError";
  }
}

async function failTokenCall(context: string, res: Response): Promise<never> {
  log.error("strava token call failed", { call: context, status: res.status, body: await res.text().catch(() => "") });
  if (res.status === 400 || res.status === 401) throw new StravaAuthError(context, res.status);
  throw new Error(`${context}: Strava returned ${res.status}`);
}

// Strava meters every app on two buckets, each with a 15-minute window
// (resetting at :00/:15/:30/:45) and a daily one (midnight UTC): an overall
// limit (X-RateLimit-*) and a stricter "read" limit (X-ReadRateLimit-*) that
// covers every endpoint we call. Defaults are 200/2000 overall and 100/1000
// read, but apps can differ — so we read both from the response headers and
// steer by whichever window is closest to running out.
// https://developers.strava.com/docs/rate-limits/

export interface RateWindowUsage {
  used: number;
  limit: number;
}

export interface RateInfo {
  // Highest used/limit ratio across both buckets and both windows; 0 when no
  // usable headers came back.
  fraction: number;
  // Which window that is — "daily" means waiting 15 minutes won't help.
  window: "fifteenMin" | "daily";
  fifteenMin: RateWindowUsage | null;
  daily: RateWindowUsage | null;
}

function parsePair(header: string | null): [number, number] | null {
  if (!header) return null;
  const parts = header.split(",").map((p) => Number(p.trim()));
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return null;
  return [parts[0], parts[1]];
}

export function parseRateInfo(headers: Headers): RateInfo {
  const info: RateInfo = { fraction: 0, window: "fifteenMin", fifteenMin: null, daily: null };

  for (const prefix of ["X-RateLimit", "X-ReadRateLimit"]) {
    const limit = parsePair(headers.get(`${prefix}-Limit`));
    const usage = parsePair(headers.get(`${prefix}-Usage`));
    if (!limit || !usage) continue;

    (["fifteenMin", "daily"] as const).forEach((window, i) => {
      // Some apps get -1 or 0 limits back (seen on Strava's forum) — that
      // tells us nothing, so it's skipped rather than read as "no quota".
      if (limit[i] <= 0) return;
      const fraction = usage[i] / limit[i];
      const current = info[window];
      if (!current || fraction > current.used / current.limit) info[window] = { used: usage[i], limit: limit[i] };
      if (fraction > info.fraction) {
        info.fraction = fraction;
        info.window = window;
      }
    });
  }
  return info;
}

export interface FetchActivitiesResult {
  activities: StravaActivityResponse[];
  rate: RateInfo;
}

async function stravaGet(accessToken: string, path: string): Promise<Response> {
  const res = await fetchWithRetry(
    `${STRAVA_API}${path}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    { label: `strava GET ${path.split("?")[0].replace(/\/\d+/g, "/:id")}` },
  );
  if (res.status === 429) {
    log.warn("strava rate limit hit (429)", { rate: parseRateInfo(res.headers) });
    throw new Error("RATE_LIMIT_EXCEEDED");
  }
  if (res.status === 401) throw new StravaAuthError("Strava API call", 401);
  return res;
}

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID!,
    redirect_uri: process.env.STRAVA_REDIRECT_URI!,
    response_type: "code",
    approval_prompt: "auto",
    scope: "read,activity:read_all",
    state,
  });
  return `https://www.strava.com/oauth/authorize?${params}`;
}

export async function exchangeCode(code: string): Promise<StravaTokenResponse> {
  // Codes are single-use, so no retries: a retried exchange after a lost
  // response would fail anyway.
  const res = await fetchWithRetry(
    STRAVA_AUTH_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
      }),
    },
    { label: "strava POST /oauth/token (code)", retries: 0 },
  );
  if (!res.ok) return failTokenCall("Token exchange failed", res);
  return res.json() as Promise<StravaTokenResponse>;
}

export async function refreshToken(refreshToken: string): Promise<StravaRefreshResponse> {
  // No retries either: Strava may rotate the refresh token, and a request
  // whose response was lost could already have consumed the old one. The
  // next sync simply tries again.
  const res = await fetchWithRetry(
    STRAVA_AUTH_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    },
    { label: "strava POST /oauth/token (refresh)", retries: 0 },
  );
  if (!res.ok) return failTokenCall("Token refresh failed", res);
  return res.json() as Promise<StravaRefreshResponse>;
}

export async function fetchActivities(
  accessToken: string,
  options: { after?: number; page?: number; perPage?: number } = {},
): Promise<FetchActivitiesResult> {
  const params = new URLSearchParams({
    page: String(options.page ?? 1),
    per_page: String(options.perPage ?? 200),
  });
  if (options.after) params.set("after", String(options.after));

  const res = await stravaGet(accessToken, `/athlete/activities?${params}`);
  if (!res.ok) throw new Error(`Strava activities fetch failed: ${res.status}`);

  return { activities: (await res.json()) as StravaActivityResponse[], rate: parseRateInfo(res.headers) };
}

export interface FetchActivityDetailResult {
  detail: StravaActivityDetail;
  rate: RateInfo;
}

export async function fetchActivityDetail(accessToken: string, stravaId: number): Promise<FetchActivityDetailResult> {
  const res = await stravaGet(accessToken, `/activities/${stravaId}`);
  if (!res.ok) throw new Error(`Strava activity detail fetch failed: ${res.status}`);
  return { detail: (await res.json()) as StravaActivityDetail, rate: parseRateInfo(res.headers) };
}

export interface FetchActivityStreamsResult {
  // null when Strava has no streams for this activity at all (404) — manual
  // entries and some indoor/no-GPS activities have no time-series data.
  streams: StravaStreamSet | null;
  rate: RateInfo;
}

export async function fetchActivityStreams(accessToken: string, stravaId: number): Promise<FetchActivityStreamsResult> {
  const params = new URLSearchParams({
    keys: STREAM_KEYS.join(","),
    key_by_type: "true",
  });

  const res = await stravaGet(accessToken, `/activities/${stravaId}/streams?${params}`);
  const rate = parseRateInfo(res.headers);

  if (res.status === 404) return { streams: null, rate };
  if (!res.ok) throw new Error(`Strava streams fetch failed: ${res.status}`);

  return { streams: (await res.json()) as StravaStreamSet, rate };
}
