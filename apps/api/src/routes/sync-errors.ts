import type { ApiErrorBody, ApiErrorCode } from "@goalsplit/types";
import { errorBody } from "../lib/api-errors.js";
import { HttpTimeoutError } from "../lib/http.js";
import { StravaAuthError } from "../lib/strava-client.js";
import { SyncInProgressError, type SyncSource } from "../services/sync-runs.service.js";
import { STRAVA_REAUTH_REQUIRED } from "../services/token.service.js";

// Maps sync failures to responses the UI can show as-is. `code` lets the
// client tell an upstream credential problem (reconnect Strava, renew the
// Garmin key) from its own session expiring — all three are 401s.
export interface SyncErrorResponse {
  status: number;
  body: ApiErrorBody;
}

export function syncErrorResponse(err: unknown, source: SyncSource): SyncErrorResponse {
  const name = source === "strava" ? "Strava" : "Garmin";
  const message = err instanceof Error ? err.message : "";
  const respond = (status: number, error: string, code: ApiErrorCode): SyncErrorResponse => ({
    status,
    body: errorBody(status, code, error),
  });

  if (err instanceof SyncInProgressError) {
    return respond(409, `A ${name} sync is already running — wait for it to finish`, "SYNC_IN_PROGRESS");
  }
  if (message === STRAVA_REAUTH_REQUIRED || err instanceof StravaAuthError) {
    return respond(
      401,
      "Strava access was revoked or has expired — use Reconnect Strava on the dashboard",
      STRAVA_REAUTH_REQUIRED,
    );
  }
  if (message === "RATE_LIMIT_EXCEEDED") {
    return respond(429, "Strava rate limit reached — try again in 15 minutes", "RATE_LIMITED");
  }
  if (message === "GARMIN_KEY_REJECTED") {
    return respond(
      401,
      "Garmin rejected the API key. It may have expired: create a new one in Garmin Connect → Personal API Key",
      "GARMIN_KEY_REJECTED",
    );
  }
  if (message === "GARMIN_RATE_LIMITED") {
    return respond(429, "Garmin is rate limiting requests — try again later. Progress so far is saved", "RATE_LIMITED");
  }
  if (err instanceof HttpTimeoutError) {
    return respond(504, `${name} didn't respond in time — progress so far is saved, try again shortly`, "UPSTREAM_TIMEOUT");
  }
  return respond(502, `${name} sync failed — progress so far is saved; details are in the API logs`, "SYNC_FAILED");
}
