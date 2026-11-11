import * as Sentry from "@sentry/nextjs";
import { dataCollection, scrubEvent } from "@/lib/sentry-options";

// Browser-side error tracking: uncaught errors and unhandled rejections in
// client components (sync buttons, charts, the PR manager). Off unless
// NEXT_PUBLIC_SENTRY_DSN was set at build time. Events go through the
// same-origin /monitoring tunnel (next.config.ts) so ad blockers don't drop
// them. No session replay, no tracing by default.

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0),
    dataCollection,
    initialScope: { tags: { service: "web", runtime: "browser" } },
    beforeSend: scrubEvent,
  });
}

// Lets Sentry attribute client navigations when tracing is enabled.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
