import { Router } from "express";
import type { Goal } from "@goalsplit/types";

export const goalsRouter = Router();

const NOW = new Date().toISOString();

// prettier-ignore
const SEED: Goal[] = [
  // ── Running ──────────────────────────────────────────────────────────────
  { id: "g-beer-mile",    name: "Beer Mile",            category: "running",   type: "completion", targetValue: 1,     currentValue: 0,    unit: "completion", status: "active",    prioritized: false, createdAt: NOW, updatedAt: NOW },
  { id: "g-sub6-mile",    name: "Sub 6 Minute Mile",    category: "running",   type: "time",       targetValue: 360,   currentValue: 355,  unit: "seconds",    status: "completed", prioritized: false, createdAt: NOW, updatedAt: NOW },
  { id: "g-sub20-5k",     name: "Sub 20 Minute 5K",     category: "running",   type: "time",       targetValue: 1200,  currentValue: 1186, unit: "seconds",    status: "completed", prioritized: false, createdAt: NOW, updatedAt: NOW },
  { id: "g-sub40-10k",    name: "Sub 40 Minute 10K",    category: "running",   type: "time",       targetValue: 2400,  currentValue: 2382, unit: "seconds",    status: "completed", prioritized: false, createdAt: NOW, updatedAt: NOW },
  { id: "g-sub130-hm",    name: "Sub 1:30 Half Marathon", category: "running", type: "time",       targetValue: 5400,  currentValue: 5436, unit: "seconds",    status: "active",    prioritized: true,  createdAt: NOW, updatedAt: NOW },
  { id: "g-sub330-mara",  name: "Sub 3:30 Marathon",    category: "running",   type: "time",       targetValue: 12600, currentValue: 12730, unit: "seconds",   status: "active",    prioritized: true,  createdAt: NOW, updatedAt: NOW },
  { id: "g-sub300-mara",  name: "Sub 3:00 Marathon",    category: "running",   type: "time",       targetValue: 10800, currentValue: 12730, unit: "seconds",   status: "active",    prioritized: false, createdAt: NOW, updatedAt: NOW },
  { id: "g-mara-7cont",   name: "Marathon on Every Continent", category: "running", type: "completion", targetValue: 7, currentValue: 0,  unit: "continents", status: "active",    prioritized: false, createdAt: NOW, updatedAt: NOW },
  { id: "g-wings35k",     name: "35K Wings for Life Run (5:09/km)", category: "running", type: "distance", targetValue: 35, currentValue: 0, unit: "km",  status: "active",    prioritized: false, createdAt: NOW, updatedAt: NOW },

  // ── Triathlon & Multi-Sport ───────────────────────────────────────────────
  { id: "g-tri-complete", name: "Complete a Triathlon",        category: "triathlon", type: "completion", targetValue: 1,     currentValue: 0, unit: "completion", status: "active", prioritized: false, createdAt: NOW, updatedAt: NOW },
  { id: "g-oly-tri",      name: "Sub 3 Hour Olympic Triathlon", category: "triathlon", type: "time",     targetValue: 10800, currentValue: 0, unit: "seconds",    status: "active", prioritized: false, createdAt: NOW, updatedAt: NOW },
  { id: "g-half-iron",    name: "Sub 6 Hour Half-Ironman",      category: "triathlon", type: "time",     targetValue: 21600, currentValue: 0, unit: "seconds",    status: "active", prioritized: false, createdAt: NOW, updatedAt: NOW },
  { id: "g-ironman",      name: "Sub 13 Hour Ironman",          category: "triathlon", type: "time",     targetValue: 46800, currentValue: 0, unit: "seconds",    status: "active", prioritized: false, createdAt: NOW, updatedAt: NOW },

  // ── Ultra Endurance ───────────────────────────────────────────────────────
  { id: "g-backyard",     name: "Backyard Ultra (24 Loops)",  category: "ultra", type: "completion", targetValue: 1,  currentValue: 0, unit: "completion", status: "active", prioritized: false, createdAt: NOW, updatedAt: NOW },
  { id: "g-50k",          name: "Complete 50K Trail Ultra",   category: "ultra", type: "completion", targetValue: 1,  currentValue: 0, unit: "completion", status: "active", prioritized: false, createdAt: NOW, updatedAt: NOW },
  { id: "g-100k",         name: "Complete 100K Trail Ultra",  category: "ultra", type: "completion", targetValue: 1,  currentValue: 0, unit: "completion", status: "active", prioritized: false, createdAt: NOW, updatedAt: NOW },
  { id: "g-100m",         name: "Complete 100M Trail Ultra",  category: "ultra", type: "completion", targetValue: 1,  currentValue: 0, unit: "completion", status: "active", prioritized: false, createdAt: NOW, updatedAt: NOW },
  { id: "g-utmb",         name: "Complete a UTMB Event",      category: "ultra", type: "completion", targetValue: 1,  currentValue: 0, unit: "completion", status: "active", prioritized: false, createdAt: NOW, updatedAt: NOW },

  // ── Adventure ─────────────────────────────────────────────────────────────
  { id: "g-swim-3k",      name: "Open Water 3K Swim",         category: "adventure", type: "completion", targetValue: 1, currentValue: 0, unit: "completion", status: "active", prioritized: false, createdAt: NOW, updatedAt: NOW },
  { id: "g-climb4k",      name: "Climb 4000m+",               category: "adventure", type: "completion", targetValue: 1, currentValue: 0, unit: "completion", status: "active", prioritized: false, createdAt: NOW, updatedAt: NOW },
  { id: "g-kili",         name: "Climb Kilimanjaro",           category: "adventure", type: "completion", targetValue: 1, currentValue: 0, unit: "completion", status: "active", prioritized: false, createdAt: NOW, updatedAt: NOW },

  // ── Fitness ───────────────────────────────────────────────────────────────
  { id: "g-mud-run",      name: "Complete a Mud Run",          category: "fitness", type: "completion", targetValue: 1,    currentValue: 0, unit: "completion", status: "active", prioritized: false, createdAt: NOW, updatedAt: NOW },
  { id: "g-murph",        name: "Complete a Murph",            category: "fitness", type: "completion", targetValue: 1,    currentValue: 0, unit: "completion", status: "active", prioritized: false, createdAt: NOW, updatedAt: NOW },
  { id: "g-hyrox",        name: "Sub 1:15 Hyrox",              category: "fitness", type: "time",       targetValue: 4500, currentValue: 0, unit: "seconds",    status: "active", prioritized: true,  createdAt: NOW, updatedAt: NOW },
  { id: "g-deadlift",     name: "Deadlift 2x Bodyweight",      category: "fitness", type: "completion", targetValue: 1,    currentValue: 0, unit: "completion", status: "active", prioritized: false, createdAt: NOW, updatedAt: NOW },
  { id: "g-bench",        name: "Bench Press Bodyweight",       category: "fitness", type: "completion", targetValue: 1,    currentValue: 0, unit: "completion", status: "active", prioritized: false, createdAt: NOW, updatedAt: NOW },
];

export let goals: Goal[] = [...SEED];

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
