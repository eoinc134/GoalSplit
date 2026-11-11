import { NextResponse } from "next/server";
import { log, webVersion } from "@/lib/log";
import { API_URL } from "@/lib/server-api";

export const dynamic = "force-dynamic";

// End-to-end health for the uptime monitor: this web server is up AND the API
// behind it is ready (database reachable, migrations applied — the API's
// /health/ready). One URL covers both services, and it's the one that's
// public even when the API only lives on Railway's private network.
//
// Public (see middleware.ts), so it only says pass/fail per service.

const API_HEALTH_URL = `${API_URL.replace(/\/api\/?$/, "")}/health/ready`;
const TIMEOUT_MS = 3000;

export async function GET() {
  const started = Date.now();
  let api: { ok: boolean; status?: number; latencyMs: number };
  try {
    const res = await fetch(API_HEALTH_URL, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    api = { ok: res.ok, status: res.status, latencyMs: Date.now() - started };
  } catch (err) {
    api = { ok: false, latencyMs: Date.now() - started };
    log.warn("api health check failed", { event: "health.api_unreachable", err });
  }

  const ok = api.ok;
  return NextResponse.json(
    { status: ok ? "ok" : "degraded", service: "web", version: webVersion, checks: { api } },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
