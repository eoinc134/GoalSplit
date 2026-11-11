import { randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { log, withLogContext } from "../lib/logger.js";

// One log line per request: method, path, status, duration. The query string
// is left out (it carries nothing secret today, but it's where something
// would leak first), and so are headers. The request id comes from the web
// proxy when it sends one, so a browser action can be followed across both
// services; it's echoed back in X-Request-Id.

const VALID_ID = /^[\w-]{8,64}$/;

export function requestLog(req: Request, res: Response, next: NextFunction) {
  const incoming = req.get("x-request-id");
  const requestId = incoming && VALID_ID.test(incoming) ? incoming : randomBytes(8).toString("hex");
  res.setHeader("X-Request-Id", requestId);
  const started = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Math.round(Number(process.hrtime.bigint() - started) / 1e6);
    const fields = {
      requestId,
      method: req.method,
      path: req.originalUrl.split("?")[0],
      status: res.statusCode,
      durationMs,
    };
    if (req.path === "/health") log.debug("request", fields);
    else if (res.statusCode >= 500) log.error("request", fields);
    else if (res.statusCode >= 400) log.warn("request", fields);
    else log.info("request", fields);
  });

  withLogContext({ requestId }, next);
}
