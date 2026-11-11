import * as Sentry from "@sentry/nextjs";
import { dataCollection, scrubEvent, serverEnvironment, tracesSampleRate } from "@/lib/sentry-options";

// Server-side error tracking for the web app: route handlers (the API proxy,
// sign-in), server components and middleware. Next.js calls register() once
// per runtime at startup. Off unless SENTRY_DSN is set. The browser side is
// instrumentation-client.ts.

export function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: serverEnvironment(),
    tracesSampleRate: tracesSampleRate(),
    dataCollection,
    initialScope: { tags: { service: "web" } },
    beforeSend: scrubEvent,
  });
}

// Errors thrown while rendering server components or in route handlers.
export const onRequestError = Sentry.captureRequestError;
