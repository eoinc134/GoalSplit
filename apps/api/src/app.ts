import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import { router } from "./routes/index.js";
import { requireApiKey } from "./middleware/api-key.js";
import { generalLimiter, syncLimiter } from "./middleware/rate-limit.js";

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

app.use(express.json({ limit: "100kb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api", generalLimiter, requireApiKey);
app.post(["/api/activities/sync", "/api/garmin/sync"], syncLimiter);
app.use("/api", router);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found", statusCode: 404 });
});

// Last-resort handler (Express 5 routes rejected promises here too). Logs the
// detail and returns a generic body — Express's default handler would send a
// stack trace whenever NODE_ENV isn't "production".
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = (err as { status?: number }).status;
  if (status && status >= 400 && status < 500) {
    // e.g. malformed JSON or an oversized body from express.json()
    return res.status(status).json({ error: "Bad request", statusCode: status });
  }
  console.error("Unhandled API error:", err);
  return res.status(500).json({ error: "Internal server error", statusCode: 500 });
});
