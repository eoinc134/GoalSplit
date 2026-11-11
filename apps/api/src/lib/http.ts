import { log } from "./logger.js";

// fetch with a timeout and bounded retries, for every call to Strava and
// Garmin. Without a timeout a single stalled connection hangs a sync forever.
//
// Retries cover failures that are usually transient: network errors,
// timeouts, and 500/502/503/504. Never 4xx — a 401/404/429 won't change on
// retry, and retrying a 429 only burns more quota. Callers making
// non-idempotent requests (the OAuth code exchange: codes are single-use)
// pass retries: 0.

export interface RetryOptions {
  label: string; // for logs, e.g. "strava GET /athlete/activities"
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number[]; // delay before retry 1, 2, … (last value repeats)
}

const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);
const DEFAULT_BACKOFF_MS = [1000, 3000];

export class HttpTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs} ms`);
    this.name = "HttpTimeoutError";
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(url: string, init: RequestInit, options: RetryOptions): Promise<Response> {
  const { label, timeoutMs = 30_000, retries = 2, backoffMs = DEFAULT_BACKOFF_MS } = options;

  for (let attempt = 0; ; attempt++) {
    let failure: string;
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (!RETRYABLE_STATUS.has(res.status) || attempt >= retries) return res;
      failure = `HTTP ${res.status}`;
      await res.body?.cancel().catch(() => undefined);
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      const error = timedOut ? new HttpTimeoutError(label, timeoutMs) : err;
      if (attempt >= retries) throw error;
      failure = error instanceof Error ? error.message : String(error);
    }

    const delay = backoffMs[Math.min(attempt, backoffMs.length - 1)] ?? 0;
    log.warn("outbound request failed, retrying", { event: "http.outbound_retry", call: label, attempt: attempt + 1, failure, retryInMs: delay });
    await sleep(delay);
  }
}
