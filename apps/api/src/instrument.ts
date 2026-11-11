import "dotenv/config";
import * as Sentry from "@sentry/node";
import { runtime } from "./lib/runtime-info.js";
import { sanitise, setErrorReporter } from "./lib/logger.js";

// Error tracking (Sentry). Imported first thing by src/index.ts — Sentry has
// to load before express/http to instrument them. Off unless SENTRY_DSN is
// set, so tests and DSN-less local runs never report.
//
// What reaches Sentry:
// - every log.error line (the logger's error reporter, below) — handled
//   failures like a failed sync included, not only crashes;
// - anything thrown that nothing caught (Sentry's own process handlers).
// Grouped by the error's stack, tagged with the release (git commit) and
// environment, carrying the request id and the log line's fields.
//
// Privacy: dataCollection (below) keeps request bodies, cookies, query
// strings and all but three headers out of events, and beforeSend strips
// anything sensitive that gets through anyway. Tracing
// (performance spans) is off by default — SENTRY_TRACES_SAMPLE_RATE turns it on.

const dsn = process.env.SENTRY_DSN;

const SENSITIVE_HEADERS = new Set(["cookie", "authorization", "x-api-key", "set-cookie"]);

export function scrubEvent<T extends Sentry.ErrorEvent>(event: T): T {
  const request = event.request;
  if (request) {
    if (request.headers) {
      for (const name of Object.keys(request.headers)) {
        if (SENSITIVE_HEADERS.has(name.toLowerCase())) delete request.headers[name];
      }
    }
    delete request.cookies;
    delete request.query_string;
    delete request.data;
    if (request.url) request.url = request.url.split("?")[0];
  }
  return event;
}

if (dsn) {
  Sentry.init({
    dsn,
    environment: runtime.env,
    release: runtime.commit ?? undefined,
    // SDK v11 defaults collect user info, cookies, every header, query strings
    // and full request/response bodies — for this API that would include the
    // Strava code in the sign-in exchange and raw Strava payloads. Collect
    // almost nothing; scrubEvent (beforeSend) is a second line of defence.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ["user-agent", "content-type", "x-request-id"] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
    },
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
    initialScope: {
      tags: { service: runtime.service, ...(runtime.deploymentId ? { deploymentId: runtime.deploymentId } : {}) },
    },
    beforeSend: (event) => scrubEvent(event),
  });

  setErrorReporter((message, fields, err) => {
    // A 5xx request line just records that a request failed; the cause is
    // reported where it happened (a failed sync, an unhandled error). And
    // health-check 503s during an outage are the uptime monitor's job.
    if (fields.event === "http.request") return;
    Sentry.withScope((scope) => {
      const { requestId, event: eventName, source, runId } = fields as Record<string, string | undefined>;
      if (requestId) scope.setTag("requestId", requestId);
      if (eventName) scope.setTag("event", eventName);
      if (source) scope.setTag("source", source);
      if (runId) scope.setTag("runId", runId);
      // Errors are already in `fields` serialised; keep the rest as context.
      scope.setContext("log", sanitise({ message, ...fields }) as Record<string, unknown>);
      if (err) {
        scope.setExtra("logMessage", message);
        Sentry.captureException(err);
      } else {
        Sentry.captureMessage(message, "error");
      }
    });
  });
}

export { Sentry };
