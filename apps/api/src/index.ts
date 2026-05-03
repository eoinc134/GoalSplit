import "dotenv/config";
import express from "express";
import cors from "cors";
import { initSchema } from "./db/index.js";
import { router } from "./routes/index.js";

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors({ origin: process.env.FRONTEND_URL ?? "http://localhost:3000" }));
app.use(express.json());

app.use("/api", router);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

initSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`GoalSplit API running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialise database:", err);
    process.exit(1);
  });
