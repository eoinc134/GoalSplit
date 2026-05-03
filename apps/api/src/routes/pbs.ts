import { Router } from "express";
import type { PersonalBest } from "@goalsplit/types";
import { sql } from "../db/index.js";

export const pbsRouter = Router();

interface PbRow {
  id: string;
  distance: number;
  distance_label: string;
  time: number;
  pace: number;
  goal_time: number | null;
  goal_pace: number | null;
  date: string;
  run_id: string | null;
  notes: string | null;
}

function rowToPb(row: PbRow): PersonalBest {
  return {
    id: row.id,
    distance: row.distance,
    distanceLabel: row.distance_label,
    time: row.time,
    pace: row.pace,
    goalTime: row.goal_time ?? undefined,
    goalPace: row.goal_pace ?? undefined,
    date: row.date,
    runId: row.run_id ?? undefined,
    notes: row.notes ?? undefined,
  };
}

pbsRouter.get("/", async (_req, res) => {
  const rows = await sql<PbRow[]>`SELECT * FROM personal_bests ORDER BY distance ASC`;
  res.json({ data: rows.map(rowToPb) });
});

pbsRouter.post("/", async (req, res) => {
  const { distance, distanceLabel, time, pace, goalTime, goalPace, date } = req.body;
  const [row] = await sql<PbRow[]>`
    INSERT INTO personal_bests (id, distance, distance_label, time, pace, goal_time, goal_pace, date)
    VALUES (
      ${crypto.randomUUID()}, ${distance}, ${distanceLabel}, ${time}, ${pace},
      ${goalTime ?? null}, ${goalPace ?? null}, ${date}
    )
    RETURNING *
  `;
  res.status(201).json({ data: rowToPb(row) });
});

pbsRouter.patch("/:id", async (req, res) => {
  const { time, pace, goalTime, goalPace, date } = req.body;
  const [row] = await sql<PbRow[]>`
    UPDATE personal_bests SET
      time      = COALESCE(${time ?? null}, time),
      pace      = COALESCE(${pace ?? null}, pace),
      goal_time = COALESCE(${goalTime ?? null}, goal_time),
      goal_pace = COALESCE(${goalPace ?? null}, goal_pace),
      date      = COALESCE(${date ?? null}, date)
    WHERE id = ${req.params.id}
    RETURNING *
  `;
  if (!row) return res.status(404).json({ error: "PB not found", statusCode: 404 });
  return res.json({ data: rowToPb(row) });
});

pbsRouter.delete("/:id", async (req, res) => {
  const result = await sql`DELETE FROM personal_bests WHERE id = ${req.params.id} RETURNING id`;
  if (result.length === 0) return res.status(404).json({ error: "PB not found", statusCode: 404 });
  return res.status(204).send();
});
