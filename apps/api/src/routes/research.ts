import { Router } from "express";
import { buildResearchDataset } from "../lib/research-dataset.js";
import { getPhysiology, loadAnalyticsActivities } from "../services/analytics-data.service.js";
import { getCurrentUserId } from "../services/user.service.js";
import { sendError } from "../lib/api-errors.js";

// Read-only, full-history export for the Python research code (research/).
// Normally run locally against the research snapshot database, not production.
export const researchRouter = Router();

researchRouter.get("/dataset", async (_req, res) => {
  const userId = await getCurrentUserId();
  if (!userId) return sendError(res, 404, "NOT_CONNECTED", "No athlete connected — nothing to export");

  const [physiology, loaded] = await Promise.all([getPhysiology(userId), loadAnalyticsActivities(userId)]);
  // Metrics fill lazily within a time budget; an incomplete export would
  // silently bias every analysis built on it, so refuse instead.
  if (loaded.metricsPending > 0) {
    return sendError(
      res,
      503,
      "METRICS_PENDING",
      `Stream metrics still computing for ${loaded.metricsPending} activities — retry shortly`,
    );
  }

  return res.json({
    data: buildResearchDataset({
      activities: loaded.activities,
      physiology,
      today: loaded.today,
      firstActivityDate: loaded.firstActivityDate,
      generatedAt: new Date().toISOString(),
    }),
  });
});
