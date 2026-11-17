import { Router } from "express";
import { intParam, notConnected, sendError } from "../lib/api-errors.js";
import { formatPlanAdherenceMarkdown } from "../lib/plan-adherence.js";
import { weekStartOf } from "../lib/dates.js";
import { getCurrentUserId } from "../services/user.service.js";
import { getPlanAdherence, listWeeklyNotes, saveWeeklyNote } from "../services/plan.service.js";

// The training-plan study (research Proposal 3): adherence progress, and the
// weekly coaching notes Claude saves through the MCP server.
export const planRouter = Router();

export const MAX_NOTE_LENGTH = 8000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

planRouter.get("/adherence", async (req, res) => {
  const userId = await getCurrentUserId();
  const asMarkdown = req.query.format === "markdown";
  if (!userId) {
    return asMarkdown
      ? res.type("text/markdown").send("# Training-plan adherence\n\nNo athlete connected yet. Connect Strava in GoalSplit first.\n")
      : res.json({ data: null });
  }
  const adherence = await getPlanAdherence(userId);
  return asMarkdown ? res.type("text/markdown").send(formatPlanAdherenceMarkdown(adherence)) : res.json({ data: adherence });
});

planRouter.get("/notes", async (req, res) => {
  const limit = intParam(req.query.limit, 4, 1, 52);
  const userId = await getCurrentUserId();
  if (!userId) return res.json({ data: [] });
  return res.json({ data: await listWeeklyNotes(userId, limit) });
});

planRouter.put("/notes/:weekStart", async (req, res) => {
  const { weekStart } = req.params;
  const isMonday = ISO_DATE.test(weekStart) && !Number.isNaN(Date.parse(weekStart)) && weekStartOf(weekStart) === weekStart;
  if (!isMonday) return sendError(res, 400, "VALIDATION_FAILED", "weekStart must be a Monday as YYYY-MM-DD");

  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!body) return sendError(res, 400, "VALIDATION_FAILED", "body must be a non-empty string");
  if (body.length > MAX_NOTE_LENGTH) {
    return sendError(res, 400, "VALIDATION_FAILED", `body must be at most ${MAX_NOTE_LENGTH} characters`);
  }

  const userId = await getCurrentUserId();
  if (!userId) return notConnected(res, "save a note");
  return res.json({ data: await saveWeeklyNote(userId, weekStart, body) });
});
