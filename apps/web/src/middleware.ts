import { NextResponse, type NextRequest } from "next/server";
import { authDisabled, SESSION_COOKIE, sessionSecret, verifySessionValue } from "@/lib/session";

// Gate for the whole app: every page and every /api/* proxy call needs a valid
// session cookie, except the sign-in flow itself.
const PUBLIC_PATHS = new Set(["/login", "/api/auth/strava", "/api/auth/strava/callback", "/api/auth/logout"]);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  // Defence in depth on top of SameSite=Lax: refuse state-changing requests
  // a browser says came from another site.
  if (
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    request.headers.get("sec-fetch-site") === "cross-site"
  ) {
    return NextResponse.json({ error: "Cross-site request refused", statusCode: 403 }, { status: 403 });
  }

  if (PUBLIC_PATHS.has(pathname) || authDisabled()) return NextResponse.next();

  const secret = sessionSecret();
  if (!secret) {
    return NextResponse.json({ error: "Server misconfigured: SESSION_SECRET is not set", statusCode: 500 }, { status: 500 });
  }

  if (await verifySessionValue(request.cookies.get(SESSION_COOKIE)?.value, secret)) {
    return NextResponse.next();
  }

  if (isApi) {
    return NextResponse.json({ error: "Not signed in", statusCode: 401 }, { status: 401 });
  }
  // Middleware requires an absolute Location (a relative one throws), so
  // build it from the incoming URL.
  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
