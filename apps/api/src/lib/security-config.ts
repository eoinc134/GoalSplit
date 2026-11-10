// Secrets the API needs before it may serve production traffic. Outside
// production each one is optional so local dev and tests stay zero-config —
// the API then runs open, stores tokens unencrypted and accepts the first
// Strava athlete to connect (see the individual modules for details).
const REQUIRED_IN_PRODUCTION = ["API_KEY", "TOKEN_ENCRYPTION_KEY", "ALLOWED_STRAVA_ATHLETE_ID"] as const;

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function assertSecurityConfig(): void {
  const missing = REQUIRED_IN_PRODUCTION.filter((name) => !process.env[name]);

  if (isProduction() && missing.length > 0) {
    throw new Error(`Refusing to start in production without: ${missing.join(", ")}`);
  }
  if (missing.length > 0) {
    console.warn(`[security] ${missing.join(", ")} not set — fine for local dev, never for a deployed API.`);
  }
  if (process.env.API_KEY && process.env.API_KEY.length < 32) {
    throw new Error("API_KEY must be at least 32 characters (e.g. `openssl rand -hex 32`)");
  }
}
