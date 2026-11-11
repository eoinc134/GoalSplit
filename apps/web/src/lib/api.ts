import type { ApiErrorBody, ApiErrorCode } from "@goalsplit/types";

// Browser-side API client. Calls go to this app's own /api/* proxy (same
// origin, session cookie attached automatically), never to the API service
// directly. Server components use lib/server-api.ts instead.
//
// Every endpoint answers { data } on success and { error, code, statusCode }
// on failure (see ApiSuccess / ApiErrorBody in @goalsplit/types). This client
// unwraps `data`, so callers get the payload itself, and turns every failure
// — including the network being down — into an ApiError with a message
// that's safe to show.

const BASE = "/api";

export type ClientErrorCode = ApiErrorCode | "NETWORK_ERROR" | "UNEXPECTED_RESPONSE";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: ClientErrorCode,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function isErrorBody(body: unknown): body is ApiErrorBody {
  return typeof body === "object" && body !== null && "error" in body && typeof body.error === "string";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiError("Can't reach GoalSplit — check your connection and try again", 0, "NETWORK_ERROR");
  }

  if (res.status === 204) return undefined as T;
  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    if (isErrorBody(body)) {
      // Only our own session expiring sends the user to sign in — a 401 from
      // Strava or Garmin credentials is shown in place.
      if (body.code === "SESSION_REQUIRED") window.location.href = "/login";
      throw new ApiError(body.error, res.status, body.code ?? "INTERNAL_ERROR");
    }
    throw new ApiError(`Request failed (HTTP ${res.status})`, res.status, "UNEXPECTED_RESPONSE");
  }

  if (typeof body !== "object" || body === null || !("data" in body)) {
    throw new ApiError("The server sent an unexpected response", res.status, "UNEXPECTED_RESPONSE");
  }
  return body.data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: (path: string) => request<void>(path, { method: "DELETE" }),
};

export function errorMessage(err: unknown, fallback = "Something went wrong"): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
