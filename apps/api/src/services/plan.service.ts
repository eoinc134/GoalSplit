import type { PlanAdherence, WeeklyNote } from "@goalsplit/types";
import { sql } from "../db/index.js";
import { buildPlanAdherence } from "../lib/plan-adherence.js";
import { buildDailySeries, type LoadInput } from "../lib/training-load.js";
import { activityLoad } from "../lib/trimp.js";
import { getPhysiology, loadAnalyticsActivities } from "./analytics-data.service.js";

export async function getPlanAdherence(userId: string): Promise<PlanAdherence> {
  const [physiology, loaded] = await Promise.all([getPhysiology(userId), loadAnalyticsActivities(userId)]);
  const inputs: LoadInput[] = loaded.activities.map((a) => ({
    localDate: a.localDate,
    ...activityLoad(
      { histogram: a.metrics?.hrHistogram ?? null, averageHeartrate: a.averageHeartrate, movingTimeS: a.movingTimeS },
      physiology,
    ),
  }));
  const daily = loaded.firstActivityDate ? buildDailySeries(inputs, loaded.firstActivityDate, loaded.today) : [];
  return buildPlanAdherence({ activities: loaded.activities, daily, zones: physiology.zones, todayLocal: loaded.today });
}

interface NoteRow {
  week_start: string;
  body: string;
  source: string;
  created_at: Date;
  updated_at: Date;
}

function toNote(r: NoteRow): WeeklyNote {
  return {
    weekStart: r.week_start,
    body: r.body,
    source: r.source,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export async function listWeeklyNotes(userId: string, limit: number): Promise<WeeklyNote[]> {
  const rows = await sql<NoteRow[]>`
    SELECT week_start::text AS week_start, body, source, created_at, updated_at
    FROM weekly_notes WHERE user_id = ${userId}
    ORDER BY week_start DESC LIMIT ${limit}
  `;
  return rows.map(toNote);
}

// One note per week: saving again replaces it (keeping created_at).
export async function saveWeeklyNote(userId: string, weekStart: string, body: string, source = "claude"): Promise<WeeklyNote> {
  const [row] = await sql<NoteRow[]>`
    INSERT INTO weekly_notes (user_id, week_start, body, source)
    VALUES (${userId}, ${weekStart}::date, ${body}, ${source})
    ON CONFLICT (user_id, week_start)
    DO UPDATE SET body = EXCLUDED.body, source = EXCLUDED.source, updated_at = NOW()
    RETURNING week_start::text AS week_start, body, source, created_at, updated_at
  `;
  return toNote(row);
}
