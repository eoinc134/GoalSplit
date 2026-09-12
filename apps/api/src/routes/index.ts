import { Router } from "express";
import { dashboardRouter } from "./dashboard.js";
import { authRouter } from "./auth.js";
import { activitiesRouter } from "./activities.js";
import { trainingRouter } from "./training.js";
import { prsRouter } from "./prs.js";

export const router = Router();

router.use("/dashboard", dashboardRouter);
router.use("/auth", authRouter);
router.use("/activities", activitiesRouter);
router.use("/training", trainingRouter);
router.use("/prs", prsRouter);
