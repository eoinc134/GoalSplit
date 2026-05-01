import { Router } from "express";
import type { PersonalBest } from "@goalsplit/types";

export const pbsRouter = Router();

let personalBests: PersonalBest[] = [];

pbsRouter.get("/", (_req, res) => {
  res.json({ data: personalBests });
});

pbsRouter.post("/", (req, res) => {
  const pb: PersonalBest = {
    id: crypto.randomUUID(),
    ...req.body,
  };
  personalBests.push(pb);
  res.status(201).json({ data: pb });
});

pbsRouter.patch("/:id", (req, res) => {
  const idx = personalBests.findIndex((pb) => pb.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "PB not found", statusCode: 404 });
  personalBests[idx] = { ...personalBests[idx], ...req.body };
  return res.json({ data: personalBests[idx] });
});

pbsRouter.delete("/:id", (req, res) => {
  const idx = personalBests.findIndex((pb) => pb.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "PB not found", statusCode: 404 });
  personalBests.splice(idx, 1);
  return res.status(204).send();
});
