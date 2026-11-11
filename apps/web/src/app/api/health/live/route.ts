import { NextResponse } from "next/server";
import { webVersion } from "@/lib/log";

export const dynamic = "force-dynamic";

// The web server itself is up — nothing else checked. For Railway's deploy
// healthcheck on the web service, so a web deploy doesn't depend on the API
// being up at that moment.
export function GET() {
  return NextResponse.json(
    { status: "ok", service: "web", version: webVersion },
    { headers: { "Cache-Control": "no-store" } },
  );
}
