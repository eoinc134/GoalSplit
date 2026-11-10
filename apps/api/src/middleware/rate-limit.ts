import { rateLimit } from "express-rate-limit";

// Nearly all traffic reaches the API through the web app's server-side proxy,
// so per-IP limits here are close to global limits — which is what a
// single-user app wants: they cap the damage a leaked API key or a runaway
// client can do (Strava quota burn, CPU-heavy analytics), not per-visitor
// fairness. Unauthenticated visitors are stopped at the web app's middleware
// before reaching the API at all.

const common = {
  standard: "draft-7" as const,
  legacyHeaders: false,
  // Tests exercise routes far faster than any person would.
  skip: () => process.env.NODE_ENV === "test",
};

function limited(statusMessage: string) {
  return { error: statusMessage, statusCode: 429 };
}

// Every /api request. A Training page load is ~7 requests, so this leaves a
// lot of headroom for normal browsing.
export const generalLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: 600,
  message: limited("Too many requests — slow down and retry shortly"),
});

// Endpoints that call out to Strava/Garmin. Each sync can spend a big slice of
// Strava's 100-requests-per-15-minutes app quota.
export const syncLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: limited("Too many sync requests — wait a few minutes"),
});

// The OAuth code exchange — each attempt is a Strava token call.
export const authLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: 20,
  message: limited("Too many sign-in attempts — wait a few minutes"),
});
