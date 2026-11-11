import type * as Sentry from "@sentry/nextjs";

type ErrorEvent = Sentry.ErrorEvent;
type DataCollection = NonNullable<NonNullable<Parameters<typeof Sentry.init>[0]>["dataCollection"]>;

// Shared Sentry settings for the web app's three runtimes (browser, Node
// server, edge middleware) — see instrumentation.ts and
// instrumentation-client.ts. Same rules as the API (apps/api/src/instrument.ts):
// collect almost nothing about requests, strip anything sensitive that gets
// through, no tracing unless SENTRY_TRACES_SAMPLE_RATE asks for it.

const SENSITIVE_HEADERS = new Set(["cookie", "authorization", "x-api-key", "set-cookie"]);

export function scrubEvent(event: ErrorEvent): ErrorEvent {
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
    // The OAuth callback URL carries Strava's code and our state value.
    if (request.url) request.url = request.url.split("?")[0];
  }
  return event;
}

export const dataCollection: DataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: { allow: ["user-agent", "content-type", "x-request-id"] }, response: false },
  httpBodies: [],
  urlQueryParams: false,
};

export function serverEnvironment(): string {
  return process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV ?? "development";
}

export function tracesSampleRate(): number {
  return Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0);
}
