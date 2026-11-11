import type { Response } from "express";
import type { ApiErrorBody, ApiErrorCode } from "@goalsplit/types";

// The one way the API answers with an error: { error, code, statusCode }.
// `error` is a sentence a person can read (the web UI shows it as-is);
// `code` is what clients branch on. Success responses are { data } (or
// { data, total } for lists) — see ApiSuccess / ApiList in @goalsplit/types.

export function errorBody(statusCode: number, code: ApiErrorCode, error: string): ApiErrorBody {
  return { error, code, statusCode };
}

export function sendError(res: Response, statusCode: number, code: ApiErrorCode, error: string) {
  return res.status(statusCode).json(errorBody(statusCode, code, error));
}

// Reads with no athlete connected answer with empty data (there's simply
// nothing yet); actions that need one answer with this.
export function notConnected(res: Response, action = "do that") {
  return sendError(res, 401, "NOT_CONNECTED", `Connect Strava before you ${action}`);
}

export function notFound(res: Response, what = "Not found") {
  return sendError(res, 404, "NOT_FOUND", what);
}

// A non-negative integer from a query-string value, clamped to [min, max];
// `fallback` for anything absent or unparseable (instead of NaN reaching SQL).
export function intParam(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}
