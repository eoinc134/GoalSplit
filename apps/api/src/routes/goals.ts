import { Router } from "express";
import type { Goal } from "@goalsplit/types";
import { sql } from "../db/index.js";

export const goalsRouter = Router();

interface GoalRow {
  id: string;
  name: string;
  description: string | null;
  category: string;
  type: string;
  target_value: number;
  current_value: number;
  unit: string;
  target_date: string | null;
  status: string;
  prioritized: boolean;
  created_at: Date;
  updated_at: Date;
}

function rowToGoal(row: GoalRow): Goal {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    category: row.category as Goal["category"],
    type: row.type as Goal["type"],
    targetValue: row.target_value,
    currentValue: row.current_value,
    unit: row.unit,
    targetDate: row.target_date ?? undefined,
    status: row.status as Goal["status"],
    prioritized: row.prioritized,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

goalsRouter.get("/", async (_req, res) => {
  const rows = await sql<GoalRow[]>`SELECT * FROM goals ORDER BY created_at ASC`;
  res.json({ data: rows.map(rowToGoal) });
});

goalsRouter.get("/:id", async (req, res) => {
  const [row] = await sql<GoalRow[]>`SELECT * FROM goals WHERE id = ${req.params.id}`;
  if (!row) return res.status(404).json({ error: "Goal not found", statusCode: 404 });
  return res.json({ data: rowToGoal(row) });
});

goalsRouter.post("/", async (req, res) => {
  const { name, description, category, type, targetValue, currentValue = 0, unit, targetDate, status = "active", prioritized = false } = req.body;
  const [row] = await sql<GoalRow[]>`
    INSERT INTO goals (id, name, description, category, type, target_value, current_value, unit, target_date, status, prioritized)
    VALUES (
      ${crypto.randomUUID()}, ${name}, ${description ?? null}, ${category}, ${type},
      ${targetValue}, ${currentValue}, ${unit}, ${targetDate ?? null}, ${status}, ${prioritized}
    )
    RETURNING *
  `;
  res.status(201).json({ data: rowToGoal(row) });
});

goalsRouter.patch("/:id", async (req, res) => {
  const { name, description, category, type, targetValue, currentValue, unit, targetDate, status, prioritized } = req.body;
  const [row] = await sql<GoalRow[]>`
    UPDATE goals SET
      name          = COALESCE(${name ?? null}, name),
      description   = COALESCE(${description ?? null}, description),
      category      = COALESCE(${category ?? null}, category),
      type          = COALESCE(${type ?? null}, type),
      target_value  = COALESCE(${targetValue ?? null}, target_value),
      current_value = COALESCE(${currentValue ?? null}, current_value),
      unit          = COALESCE(${unit ?? null}, unit),
      target_date   = COALESCE(${targetDate ?? null}, target_date),
      status        = COALESCE(${status ?? null}, status),
      prioritized   = COALESCE(${prioritized ?? null}, prioritized),
      updated_at    = NOW()
    WHERE id = ${req.params.id}
    RETURNING *
  `;
  if (!row) return res.status(404).json({ error: "Goal not found", statusCode: 404 });
  return res.json({ data: rowToGoal(row) });
});

goalsRouter.delete("/:id", async (req, res) => {
  const result = await sql`DELETE FROM goals WHERE id = ${req.params.id} RETURNING id`;
  if (result.length === 0) return res.status(404).json({ error: "Goal not found", statusCode: 404 });
  return res.status(204).send();
});
