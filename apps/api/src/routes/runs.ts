import { Router } from "express";
import type { Run } from "@goalsplit/types";

export const runsRouter = Router();

let runs: Run[] = [];

runsRouter.get("/", (_req, res) => {
  const sorted = [...runs].sort((a, b) => b.date.localeCompare(a.date));
  res.json({ data: sorted });
});

runsRouter.get("/:id", (req, res) => {
  const run = runs.find((r) => r.id === req.params.id);
  if (!run) return res.status(404).json({ error: "Run not found", statusCode: 404 });
  return res.json({ data: run });
});

runsRouter.post("/", (req, res) => {
  const run: Run = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...req.body,
  };
  runs.push(run);
  res.status(201).json({ data: run });
});

runsRouter.delete("/:id", (req, res) => {
  const idx = runs.findIndex((r) => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Run not found", statusCode: 404 });
  runs.splice(idx, 1);
  return res.status(204).send();
});
