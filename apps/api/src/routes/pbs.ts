import { Router } from "express";
import type { PersonalBest } from "@goalsplit/types";

export const pbsRouter = Router();

// Times in seconds, paces in seconds per km
// 5k:  19:46 = 1186s  pace 3:57 = 237s/km  | goal 19:00 = 1140s  pace 3:45 = 225s/km
// 10k: 39:42 = 2382s  pace 3:58 = 238s/km  | goal 39:00 = 2340s  pace 3:54 = 234s/km
// HM:  1:30:36 = 5436s pace 4:17 = 257s/km | goal 1:25:00 = 5100s pace 4:02 = 242s/km
// M:   3:32:10 = 12730s pace 5:01 = 301s/km | goal 3:20:00 = 12000s pace 4:44 = 284s/km
const SEED: PersonalBest[] = [
  {
    id: "pb-5k",
    distance: 5,
    distanceLabel: "5K",
    time: 1186,
    pace: 237,
    goalTime: 1140,
    goalPace: 225,
    date: "2024-09-15",
  },
  {
    id: "pb-10k",
    distance: 10,
    distanceLabel: "10K",
    time: 2382,
    pace: 238,
    goalTime: 2340,
    goalPace: 234,
    date: "2024-10-20",
  },
  {
    id: "pb-hm",
    distance: 21.0975,
    distanceLabel: "Half Marathon",
    time: 5436,
    pace: 257,
    goalTime: 5100,
    goalPace: 242,
    date: "2024-11-03",
  },
  {
    id: "pb-mara",
    distance: 42.195,
    distanceLabel: "Marathon",
    time: 12730,
    pace: 301,
    goalTime: 12000,
    goalPace: 284,
    date: "2025-04-06",
  },
];

let personalBests: PersonalBest[] = [...SEED];

pbsRouter.get("/", (_req, res) => {
  res.json({ data: personalBests });
});

pbsRouter.post("/", (req, res) => {
  const pb: PersonalBest = { id: crypto.randomUUID(), ...req.body };
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
