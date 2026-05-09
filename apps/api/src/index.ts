import { app } from "./app.js";
import { initSchema } from "./db/index.js";

const PORT = process.env.PORT ?? 3001;

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
