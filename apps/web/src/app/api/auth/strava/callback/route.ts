import { NextResponse, type NextRequest } from "next/server";
import { apiFetch } from "@/lib/server-api";
import {
  cookieOptions,
  createSessionValue,
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  sessionSecret,
} from "@/lib/session";

export const dynamic = "force-dynamic";

// Step 2: Strava redirects here (STRAVA_REDIRECT_URI on the API must point at
// this route). Check state, have the API exchange the code — it enforces the
// athlete allowlist and stores the tokens — then issue the session cookie.

function redirect(location: string) {
  const res = new NextResponse(null, { status: 303, headers: { Location: location } });
  res.cookies.set(OAUTH_STATE_COOKIE, "", cookieOptions(0, "/api/auth/strava"));
  return res;
}

const fail = (reason: string) => redirect(`/login?error=${encodeURIComponent(reason)}`);

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;

  if (params.get("error")) return fail("denied");
  if (!state || !expectedState || state !== expectedState) return fail("state");
  if (!code) return fail("no_code");

  let athleteId: number;
  try {
    const res = await apiFetch("/auth/strava/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // `scope` is what the athlete actually granted on Strava's consent
      // screen; the API refuses sign-in without activity:read_all.
      body: JSON.stringify({ code, scope: params.get("scope") ?? undefined }),
    });
    if (res.status === 403) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return fail(body.error === "insufficient_scope" ? "scope" : "not_allowed");
    }
    if (res.status === 429) return fail("rate_limited");
    if (!res.ok) return fail("exchange");
    athleteId = ((await res.json()) as { data: { athleteId: number } }).data.athleteId;
  } catch (err) {
    console.error("Strava code exchange via API failed:", err);
    return fail("unavailable");
  }

  const response = redirect("/");
  const secret = sessionSecret();
  if (secret) {
    response.cookies.set(SESSION_COOKIE, await createSessionValue(athleteId, secret), cookieOptions(SESSION_TTL_SECONDS));
  }
  return response;
}
