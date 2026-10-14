import { Router } from "express";
import { sql } from "../db/index.js";
import { getCurrentUserId } from "../services/user.service.js";

export const dashboardRouter = Router();

dashboardRouter.get("/stats", async (_req, res) => {
  const userId = await getCurrentUserId();

  let totalRuns = 0;
  let totalDistance = 0; // km
  let weeklyDistance = 0; // km

  if (userId) {
    const [runStats] = await sql<{ count: number; total_distance: number }[]>`
      SELECT
        COUNT(*)::INTEGER          AS count,
        COALESCE(SUM(distance), 0) AS total_distance
      FROM activities
      WHERE user_id = ${userId} AND type = 'Run'
    `;

    const [weekStats] = await sql<{ weekly_distance: number }[]>`
      SELECT COALESCE(SUM(distance), 0) AS weekly_distance
      FROM activities
      WHERE user_id  = ${userId}
        AND type     = 'Run'
        AND start_date >= date_trunc('week', NOW())
    `;

    totalRuns = runStats?.count ?? 0;
    // distance is stored in metres → convert to km
    totalDistance = Math.round((runStats?.total_distance ?? 0) / 100) / 10;
    weeklyDistance = Math.round((weekStats?.weekly_distance ?? 0) / 100) / 10;
  }

  return res.json({
    data: { totalRuns, totalDistance, weeklyDistance },
  });
});
