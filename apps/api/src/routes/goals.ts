import { Router } from "express";
import type { Goal } from "@goalsplit/types";

export const goalsRouter = Router();

// Placeholder in-memory store — replace with DB later
let goals: Goal[] = [];

goalsRouter.get("/", (_req, res) => {
  res.json({ data: goals });
});

goalsRouter.get("/:id", (req, res) => {
  const goal = goals.find((g) => g.id === req.params.id);
  if (!goal) return res.status(404).json({ error: "Goal not found", statusCode: 404 });
  return res.json({ data: goal });
});

goalsRouter.post("/", (req, res) => {
  const now = new Date().toISOString();
  const goal: Goal = {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    currentValue: 0,
    status: "active",
    ...req.body,
  };
  goals.push(goal);
  res.status(201).json({ data: goal });
});

goalsRouter.patch("/:id", (req, res) => {
  const idx = goals.findIndex((g) => g.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Goal not found", statusCode: 404 });
  goals[idx] = { ...goals[idx], ...req.body, updatedAt: new Date().toISOString() };
  return res.json({ data: goals[idx] });
});

goalsRouter.delete("/:id", (req, res) => {
  const idx = goals.findIndex((g) => g.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Goal not found", statusCode: 404 });
  goals.splice(idx, 1);
  return res.status(204).send();
});
