import { Router } from "express";

export const dashboardRouter = Router();

dashboardRouter.get("/stats", (_req, res) => {
  // Placeholder — wire up to real data once DB is in place
  res.json({
    data: {
      totalRuns: 0,
      totalDistance: 0,
      totalDuration: 0,
      weeklyDistance: 0,
      activeGoals: 0,
      recentRuns: [],
      personalBests: [],
    },
  });
});
