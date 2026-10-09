import "dotenv/config";
import express from "express";
import cors from "cors";
import { router } from "./routes/index.js";

export const app = express();

// Express sets this by default, telling any client exactly which framework
// (and version, via other fingerprinting) is running — no reason to hand
// that out.
app.disable("x-powered-by");

app.use(cors({ origin: process.env.FRONTEND_URL ?? "http://localhost:3000" }));
app.use(express.json());

app.use("/api", router);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});
