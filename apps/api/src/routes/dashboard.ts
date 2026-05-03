import { Router } from "express";
import { sql } from "../db/index.js";

export const dashboardRouter = Router();

dashboardRouter.get("/stats", async (_req, res) => {
  const [user] = await sql<{ id: string }[]>`SELECT id FROM users LIMIT 1`;

  let totalRuns = 0;
  let totalDistance = 0; // km
  let weeklyDistance = 0; // km

  if (user) {
    const [runStats] = await sql<{ count: number; total_distance: number }[]>`
      SELECT
        COUNT(*)::INTEGER          AS count,
        COALESCE(SUM(distance), 0) AS total_distance
      FROM activities
      WHERE user_id = ${user.id} AND type = 'Run'
    `;

    const [weekStats] = await sql<{ weekly_distance: number }[]>`
      SELECT COALESCE(SUM(distance), 0) AS weekly_distance
      FROM activities
      WHERE user_id  = ${user.id}
        AND type     = 'Run'
        AND start_date >= date_trunc('week', NOW())
    `;

    totalRuns = runStats?.count ?? 0;
    // distance is stored in metres → convert to km
    totalDistance = Math.round((runStats?.total_distance ?? 0) / 100) / 10;
    weeklyDistance = Math.round((weekStats?.weekly_distance ?? 0) / 100) / 10;
  }

  const [goalStats] = await sql<{ active: number; prioritized: number }[]>`
    SELECT
      COUNT(*) FILTER (WHERE status = 'active')::INTEGER                        AS active,
      COUNT(*) FILTER (WHERE status = 'active' AND prioritized = true)::INTEGER AS prioritized
    FROM goals
  `;
  const activeGoals = goalStats?.active ?? 0;
  const prioritizedGoals = goalStats?.prioritized ?? 0;

  return res.json({
    data: { totalRuns, totalDistance, weeklyDistance, activeGoals, prioritizedGoals },
  });
});
