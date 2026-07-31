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

export interface RateLimit {
  fifteenMin: number;
  daily: number;
}

export interface FetchActivitiesResult {
  activities: StravaActivityResponse[];
  usage: RateLimit;
  limit: RateLimit;
}

function parseRateHeader(header: string | null, defaults: [number, number]): RateLimit {
  const parts = (header ?? "").split(",").map(Number);
  return {
    fifteenMin: parts[0] ?? defaults[0],
    daily: parts[1] ?? defaults[1],
  };
}

export function buildAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID!,
    redirect_uri: process.env.STRAVA_REDIRECT_URI!,
    response_type: "code",
    approval_prompt: "auto",
    scope: "read,activity:read_all",
  });
  return `https://www.strava.com/oauth/authorize?${params}`;
}

export async function exchangeCode(code: string): Promise<StravaTokenResponse> {
  const res = await fetch(STRAVA_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${body}`);
  }
  return res.json() as Promise<StravaTokenResponse>;
}

export async function refreshToken(refreshToken: string): Promise<StravaRefreshResponse> {
  const res = await fetch(STRAVA_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${body}`);
  }
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

  const res = await fetch(`${STRAVA_API}/athlete/activities?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 429) throw new Error("RATE_LIMIT_EXCEEDED");
  if (!res.ok) throw new Error(`Strava activities fetch failed: ${res.status}`);

  return {
    activities: (await res.json()) as StravaActivityResponse[],
    usage: parseRateHeader(res.headers.get("X-RateLimit-Usage"), [0, 0]),
    limit: parseRateHeader(res.headers.get("X-RateLimit-Limit"), [100, 1000]),
  };
}

export interface FetchActivityDetailResult {
  detail: StravaActivityDetail;
  usage: RateLimit;
  limit: RateLimit;
}

export async function fetchActivityDetail(
  accessToken: string,
  stravaId: number,
): Promise<FetchActivityDetailResult> {
  const res = await fetch(`${STRAVA_API}/activities/${stravaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 429) throw new Error("RATE_LIMIT_EXCEEDED");
  if (!res.ok) throw new Error(`Strava activity detail fetch failed: ${res.status}`);

  return {
    detail: (await res.json()) as StravaActivityDetail,
    usage: parseRateHeader(res.headers.get("X-RateLimit-Usage"), [0, 0]),
    limit: parseRateHeader(res.headers.get("X-RateLimit-Limit"), [100, 1000]),
  };
}
