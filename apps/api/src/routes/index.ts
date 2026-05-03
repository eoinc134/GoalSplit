import { Router } from "express";
import { goalsRouter } from "./goals.js";
import { runsRouter } from "./runs.js";
import { pbsRouter } from "./pbs.js";
import { dashboardRouter } from "./dashboard.js";
import { authRouter } from "./auth.js";
import { activitiesRouter } from "./activities.js";

export const router = Router();

router.use("/goals", goalsRouter);
router.use("/runs", runsRouter);
router.use("/pbs", pbsRouter);
router.use("/dashboard", dashboardRouter);
router.use("/auth", authRouter);
router.use("/activities", activitiesRouter);
