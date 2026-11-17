import { Router } from "express";
import { authRouter } from "./auth.js";
import { activitiesRouter } from "./activities.js";
import { trainingRouter } from "./training.js";
import { prsRouter } from "./prs.js";
import { garminRouter } from "./garmin.js";
import { researchRouter } from "./research.js";
import { syncRouter } from "./sync.js";
import { planRouter } from "./plan.js";

export const router = Router();

router.use("/auth", authRouter);
router.use("/activities", activitiesRouter);
router.use("/training", trainingRouter);
router.use("/prs", prsRouter);
router.use("/garmin", garminRouter);
router.use("/research", researchRouter);
router.use("/sync", syncRouter);
router.use("/plan", planRouter);
