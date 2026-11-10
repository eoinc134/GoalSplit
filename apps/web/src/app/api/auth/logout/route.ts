import { NextResponse } from "next/server";
import { cookieOptions, SESSION_COOKIE } from "@/lib/session";

// Signs out of GoalSplit only — the Strava connection (stored tokens) stays,
// so syncing keeps working on the next sign-in.
export async function POST() {
  const response = new NextResponse(null, { status: 303, headers: { Location: "/login" } });
  response.cookies.set(SESSION_COOKIE, "", cookieOptions(0));
  return response;
}
