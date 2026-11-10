// Signed session cookie for the single allowed athlete. Signing in with Strava
// (and passing the API's athlete allowlist) is what earns one.
//
// Value: "<athleteId>.<expiresAtMs>.<base64url HMAC-SHA256>" keyed with
// SESSION_SECRET. Stateless — rotating SESSION_SECRET signs everyone out.
// Uses Web Crypto so it runs in middleware (edge runtime) and route handlers.

export const SESSION_COOKIE = "gs_session";
export const OAUTH_STATE_COOKIE = "gs_oauth_state";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

const encoder = new TextEncoder();

function base64url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return base64url(await crypto.subtle.sign("HMAC", key, encoder.encode(`gs-session-v1.${payload}`)));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function sessionSecret(): string | null {
  return process.env.SESSION_SECRET || null;
}

// Auth is only optional in `next dev` without a secret, so local work stays
// zero-config. A production build with no SESSION_SECRET fails closed.
export function authDisabled(): boolean {
  return !sessionSecret() && process.env.NODE_ENV !== "production";
}

export async function createSessionValue(athleteId: number, secret: string): Promise<string> {
  const payload = `${athleteId}.${Date.now() + SESSION_TTL_SECONDS * 1000}`;
  return `${payload}.${await sign(payload, secret)}`;
}

export async function verifySessionValue(value: string | undefined, secret: string): Promise<boolean> {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [athleteId, expiresAt, signature] = parts;
  if (!/^\d+$/.test(athleteId) || !/^\d+$/.test(expiresAt) || Number(expiresAt) < Date.now()) return false;
  return constantTimeEqual(signature, await sign(`${athleteId}.${expiresAt}`, secret));
}

export function randomState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function cookieOptions(maxAge: number, path = "/") {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Lax still sends the cookie on Strava's top-level redirect back to the
    // callback, but not on cross-site POST/DELETE — that's the CSRF guard for
    // the proxied API.
    sameSite: "lax" as const,
    path,
    maxAge,
  };
}
