import { NextResponse } from "next/server";
import { apiFetch } from "@/lib/server-api";
import { cookieOptions, OAUTH_STATE_COOKIE, randomState } from "@/lib/session";

export const dynamic = "force-dynamic";

// Step 1 of "Sign in with Strava": remember a random state value in a
// short-lived cookie and send the browser to Strava's consent page carrying
// it. The callback only accepts a response echoing the same value, so nobody
// can complete a sign-in in your browser that you didn't start (login CSRF).
export async function GET() {
  const state = randomState();

  let url: string;
  try {
    const res = await apiFetch(`/auth/strava/authorize-url?state=${state}`);
    if (!res.ok) throw new Error(`API returned ${res.status}`);
    url = ((await res.json()) as { data: { url: string } }).data.url;
  } catch (err) {
    console.error("Could not start Strava sign-in:", err);
    return new NextResponse(null, { status: 303, headers: { Location: "/login?error=unavailable" } });
  }

  const response = new NextResponse(null, { status: 303, headers: { Location: url } });
  response.cookies.set(OAUTH_STATE_COOKIE, state, cookieOptions(10 * 60, "/api/auth/strava"));
  return response;
}
