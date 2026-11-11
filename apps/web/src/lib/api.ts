// Browser-side API client. Calls go to this app's own /api/* proxy (same
// origin, session cookie attached automatically), never to the API service
// directly. Server components use lib/server-api.ts instead.
const BASE = "/api";

// Carries the API's machine-readable `code` (e.g. SYNC_IN_PROGRESS,
// STRAVA_REAUTH_REQUIRED) alongside the human message.
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    // Only our own session expiring sends the user to sign in — a 401 from
    // Strava or Garmin credentials is shown in place.
    if (body.code === "SESSION_REQUIRED") window.location.href = "/login";
    throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status, body.code);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: (path: string) => request<void>(path, { method: "DELETE" }),
};
