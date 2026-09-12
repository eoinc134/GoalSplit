import { Router } from "express";
import { sql } from "../db/index.js";
import {
  computeStravaBests,
  buildPrRecords,
  validateManualPrInput,
  toManualPrEntry,
  type DetailDumpRow,
  type ManualPrRow,
} from "../lib/personal-records.js";
import type { ManualPrEntry } from "@goalsplit/types";

export const prsRouter = Router();

prsRouter.get("/", async (_req, res) => {
  const [user] = await sql<{ id: string }[]>`SELECT id FROM users LIMIT 1`;
  if (!user) return res.json({ data: { records: [], manualEntries: [] } });

  // All activities, not date-windowed — a PR can come from any point in history.
  const activityRows = await sql<{ id: string; strava_id: number; name: string; local_date: string }[]>`
    SELECT id, strava_id, name, (start_date_local AT TIME ZONE 'UTC')::date::text AS local_date
    FROM activities
    WHERE user_id = ${user.id}
    ORDER BY start_date_local
  `;

  // Latest 'detail' dump per activity — same scoped-by-id lookup pattern as
  // activities.ts's fetchDumpsForActivities, projecting only best_efforts
  // (detail dumps also carry splits/laps/description we don't need here).
  const activityIds = activityRows.map((a) => a.id);
  const dumpRows = activityIds.length
    ? await sql<{ activity_id: string; best_efforts: unknown }[]>`
        SELECT DISTINCT ON (activity_id) activity_id, payload -> 'best_efforts' AS best_efforts
        FROM activity_dumps
        WHERE activity_id = ANY(${activityIds}) AND source = 'detail'
        ORDER BY activity_id, fetched_at DESC
      `
    : [];

  const bestEffortsByActivity = new Map(dumpRows.map((r) => [r.activity_id, r.best_efforts]));
  const detailRows: DetailDumpRow[] = activityRows.map((a) => ({
    activity_id: a.id,
    strava_id: a.strava_id,
    name: a.name,
    local_date: a.local_date,
    best_efforts: bestEffortsByActivity.get(a.id) ?? null,
  }));

  const stravaBests = computeStravaBests(detailRows);

  const manualRows = await sql<ManualPrRow[]>`
    SELECT m.id, m.distance_label, m.time_seconds, m.achieved_date::text AS achieved_date,
           m.notes, m.source_activity_id, a.name AS source_activity_name, m.created_at
    FROM manual_prs m
    LEFT JOIN activities a ON a.id = m.source_activity_id
    WHERE m.user_id = ${user.id}
    ORDER BY m.achieved_date DESC
  `;
  const manualEntries: ManualPrEntry[] = manualRows.map(toManualPrEntry);

  const records = buildPrRecords(stravaBests, manualEntries);

  return res.json({ data: { records, manualEntries } });
});

prsRouter.post("/", async (req, res) => {
  const validation = validateManualPrInput(req.body);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error, statusCode: 400 });
  }

  const [user] = await sql<{ id: string }[]>`SELECT id FROM users LIMIT 1`;
  if (!user) {
    return res.status(401).json({ error: "Connect Strava before adding personal records", statusCode: 401 });
  }

  const { distanceLabel, timeSeconds, achievedDate, notes, sourceActivityId } = req.body as {
    distanceLabel: string;
    timeSeconds: number;
    achievedDate: string;
    notes?: string | null;
    sourceActivityId?: string | null;
  };

  if (sourceActivityId) {
    const [owned] = await sql<{ id: string }[]>`
      SELECT id FROM activities WHERE id = ${sourceActivityId} AND user_id = ${user.id}
    `;
    if (!owned) {
      return res.status(400).json({ error: "sourceActivityId does not exist or isn't yours", statusCode: 400 });
    }
  }

  const [row] = await sql<ManualPrRow[]>`
    INSERT INTO manual_prs (id, user_id, distance_label, time_seconds, achieved_date, notes, source_activity_id)
    VALUES (
      ${crypto.randomUUID()}, ${user.id}, ${distanceLabel.trim()}, ${timeSeconds}, ${achievedDate},
      ${notes?.trim() || null}, ${sourceActivityId || null}
    )
    RETURNING id, distance_label, time_seconds, achieved_date::text AS achieved_date,
              notes, source_activity_id, NULL AS source_activity_name, created_at
  `;

  // Resolve the linked activity's name for the response (RETURNING can't join).
  let sourceActivityName: string | null = null;
  if (row.source_activity_id) {
    const [activity] = await sql<{ name: string }[]>`SELECT name FROM activities WHERE id = ${row.source_activity_id}`;
    sourceActivityName = activity?.name ?? null;
  }

  return res.status(201).json({ data: toManualPrEntry({ ...row, source_activity_name: sourceActivityName }) });
});

prsRouter.delete("/:id", async (req, res) => {
  const [user] = await sql<{ id: string }[]>`SELECT id FROM users LIMIT 1`;
  if (!user) return res.status(404).json({ error: "Not found", statusCode: 404 });

  const result = await sql`
    DELETE FROM manual_prs WHERE id = ${req.params.id} AND user_id = ${user.id}
  `;

  if (result.count === 0) {
    return res.status(404).json({ error: "Not found", statusCode: 404 });
  }
  return res.status(204).send();
});
