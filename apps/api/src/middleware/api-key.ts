import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { sendError } from "../lib/api-errors.js";

// Every /api route sits behind a shared secret. Browsers never hold it: the
// web app is a backend-for-frontend that checks the user's session, then
// forwards to this API server-side with the key attached (apps/web/src/app/api).
// The MCP trainer and research tooling send it the same way.
//
// With API_KEY unset the API runs open, which is only allowed outside
// production — assertSecurityConfig() refuses to boot a production API
// without it.

function digest(value: string): Buffer {
  // Hash first so timingSafeEqual always compares equal-length buffers and
  // the comparison leaks nothing about the key's length.
  return createHash("sha256").update(value).digest();
}

function presentedKey(req: Request): string | null {
  const header = req.get("x-api-key");
  if (header) return header;
  const auth = req.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice("Bearer ".length);
  return null;
}

export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.API_KEY;
  if (!expected) return next();

  const presented = presentedKey(req);
  if (presented && timingSafeEqual(digest(presented), digest(expected))) return next();

  return sendError(res, 401, "UNAUTHORIZED", "Missing or invalid API key");
}
