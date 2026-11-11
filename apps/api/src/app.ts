import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import { router } from "./routes/index.js";
import { healthRouter } from "./routes/health.js";
import { requireApiKey } from "./middleware/api-key.js";
import { generalLimiter, syncLimiter } from "./middleware/rate-limit.js";
import { requestLog } from "./middleware/request-log.js";
import { log } from "./lib/logger.js";
import { sendError } from "./lib/api-errors.js";

export const app = express();

// Express sets this by default, telling any client exactly which framework
// (and version, via other fingerprinting) is running — no reason to hand
// that out.
app.disable("x-powered-by");

// Railway terminates TLS in one proxy hop in front of the app; trust exactly
// that hop so req.ip (used for rate-limit keys) is the real client address
// rather than whatever a client puts in X-Forwarded-For.
app.set("trust proxy", 1);

// No CORS middleware on purpose: browsers never call this API directly (the
// web app proxies server-side), and without Access-Control-Allow-Origin
// headers browsers refuse every cross-origin read.

app.use(requestLog);
app.use(express.json({ limit: "100kb" }));

// /health, /health/live, /health/ready — public, outside the API key and
// rate limits (see routes/health.ts).
app.use(healthRouter);

app.use("/api", generalLimiter, requireApiKey);
app.post(["/api/activities/sync", "/api/garmin/sync"], syncLimiter);
app.use("/api", router);

app.use((_req: Request, res: Response) => {
  sendError(res, 404, "NOT_FOUND", "No such endpoint");
});

// Last-resort handler (Express 5 routes rejected promises here too). Logs the
// detail and returns a generic body — Express's default handler would send a
// stack trace whenever NODE_ENV isn't "production".
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = (err as { status?: number }).status;
  if (status && status >= 400 && status < 500) {
    // e.g. malformed JSON or an oversized body from express.json()
    return sendError(res, status, "BAD_REQUEST", "Malformed or oversized request body");
  }
  log.error("unhandled API error", { event: "http.unhandled_error", err });
  return sendError(res, 500, "INTERNAL_ERROR", "Something went wrong — it has been logged");
});
