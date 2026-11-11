import { randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { log, withLogContext } from "../lib/logger.js";

// One `http.request` log line per request: method, path, matched route,
// status, duration. The query string is left out (it carries nothing secret
// today, but it's where something would leak first), and so are headers.
// The request id comes from the web proxy when it sends one, so a browser
// action can be followed across both services; it's echoed back in
// X-Request-Id and attached to every log line written while handling it.

const VALID_ID = /^[\w-]{8,64}$/;

// Slower than this is logged as a warning (slow: true), so slow endpoints
// show up in a `@slow:true` filter without trawling every line.
export const SLOW_REQUEST_MS = Number(process.env.SLOW_REQUEST_MS ?? 2000);

export function requestLog(req: Request, res: Response, next: NextFunction) {
  const incoming = req.get("x-request-id");
  const requestId = incoming && VALID_ID.test(incoming) ? incoming : randomBytes(8).toString("hex");
  res.setHeader("X-Request-Id", requestId);
  const started = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Math.round(Number(process.hrtime.bigint() - started) / 1e6);
    const path = req.originalUrl.split("?")[0];
    // The route pattern (/api/activities/:id) groups requests far better than
    // the raw path; set by Express once a route matched.
    const route = req.route?.path ? `${req.baseUrl}${String(req.route.path)}` : undefined;
    const slow = durationMs >= SLOW_REQUEST_MS;
    const fields = {
      event: "http.request",
      requestId,
      method: req.method,
      path,
      ...(route && route !== path ? { route } : {}),
      status: res.statusCode,
      durationMs,
      ...(slow ? { slow: true } : {}),
    };
    // Health probes every few minutes would drown everything else.
    if (path.startsWith("/health") && res.statusCode < 500) log.debug("request", fields);
    else if (res.statusCode >= 500) log.error("request failed", fields);
    else if (res.statusCode >= 400 || slow) log.warn(slow ? "slow request" : "request", fields);
    else log.info("request", fields);
  });

  withLogContext({ requestId }, next);
}
