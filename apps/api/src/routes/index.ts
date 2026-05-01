import { Router } from "express";
import { goalsRouter } from "./goals.js";
import { runsRouter } from "./runs.js";
import { pbsRouter } from "./pbs.js";
import { dashboardRouter } from "./dashboard.js";

export const router = Router();

router.use("/goals", goalsRouter);
router.use("/runs", runsRouter);
router.use("/pbs", pbsRouter);
router.use("/dashboard", dashboardRouter);
