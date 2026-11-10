import { NextResponse, type NextRequest } from "next/server";
import { apiFetch } from "@/lib/server-api";

// Same-origin proxy from the browser to the API. middleware.ts has already
// checked the session by the time a request gets here; this adds the API key
// (server-side only) and forwards. The more specific /api/auth/* route
// handlers take precedence over this catch-all.

export const dynamic = "force-dynamic";

// The OAuth exchange and disconnect are only reachable through the dedicated
// sign-in routes, not as generic proxy calls.
const BLOCKED_PREFIXES = ["auth/strava"];

const FORWARDED_RESPONSE_HEADERS = ["content-type", "content-disposition", "retry-after", "ratelimit", "ratelimit-policy"];

async function proxy(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  // "." / ".." would be normalised away by URL parsing and could route
  // around the block list below.
  if (path.some((segment) => segment === "." || segment === "..")) {
    return NextResponse.json({ error: "Not found", statusCode: 404 }, { status: 404 });
  }
  const joined = path.map(encodeURIComponent).join("/");
  if (BLOCKED_PREFIXES.some((p) => joined === p || joined.startsWith(`${p}/`))) {
    return NextResponse.json({ error: "Not found", statusCode: 404 }, { status: 404 });
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  let upstream: Response;
  try {
    upstream = await apiFetch(`/${joined}${request.nextUrl.search}`, {
      method: request.method,
      headers,
      body: hasBody ? await request.text() : undefined,
    });
  } catch (err) {
    console.error("API proxy request failed:", err);
    return NextResponse.json({ error: "API unavailable", statusCode: 502 }, { status: 502 });
  }

  const responseHeaders = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new NextResponse(upstream.status === 204 ? null : upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
