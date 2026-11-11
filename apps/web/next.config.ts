import type { NextConfig } from "next";
// v11 moved the build-time wrapper to its own entry point.
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  transpilePackages: ["@goalsplit/types"],
  env: {
    // Baked into the browser bundle at build time, like the public DSN.
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV ?? "development",
  },
};

// Sentry build step: uploads source maps (so browser stack traces show
// TypeScript lines) and tags the release with the git commit Railway is
// deploying. Upload only happens when SENTRY_AUTH_TOKEN is set — local builds
// and CI skip it quietly. Maps are deleted after upload so they're never
// served publicly.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  release: { name: process.env.RAILWAY_GIT_COMMIT_SHA },
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  widenClientFileUpload: true,
  // Browser events go to this same-origin route, which forwards to Sentry —
  // ad blockers drop requests to *.sentry.io. Excluded from the session
  // middleware (src/middleware.ts) since it carries no app data.
  tunnelRoute: "/monitoring",
  silent: !process.env.CI,
  telemetry: false,
});
