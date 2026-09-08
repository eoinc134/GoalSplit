import { Router } from "express";
import { dashboardRouter } from "./dashboard.js";
import { authRouter } from "./auth.js";
import { activitiesRouter } from "./activities.js";

export const router = Router();

router.use("/dashboard", dashboardRouter);
router.use("/auth", authRouter);
router.use("/activities", activitiesRouter);
