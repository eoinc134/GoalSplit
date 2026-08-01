import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_URL = process.env.GOALSPLIT_API_URL ?? "http://localhost:3001/api";

const server = new McpServer({
  name: "goalsplit-trainer",
  version: "0.1.0",
});

server.registerTool(
  "get_recent_training_data",
  {
    title: "Get recent training data",
    description:
      "Fetches the user's recent GoalSplit training log (runs and other activities synced from Strava), " +
      "including per-activity distance, pace, heart rate, elevation, relative effort, splits, best efforts, " +
      "and any notes — for use as coaching context.",
    inputSchema: {
      days: z
        .number()
        .int()
        .min(1)
        .max(365)
        .optional()
        .describe("How many days of history to include. Defaults to 30."),
      type: z
        .string()
        .optional()
        .describe("Filter to one Strava activity type, e.g. 'Run'. Omit for all types."),
    },
  },
  async ({ days, type }) => {
    const params = new URLSearchParams({ format: "markdown" });
    if (days) params.set("days", String(days));
    if (type) params.set("type", type);

    const res = await fetch(`${API_URL}/activities/export?${params}`);
    if (!res.ok) {
      throw new Error(`GoalSplit API request failed: ${res.status} ${await res.text()}`);
    }

    const markdown = await res.text();
    return { content: [{ type: "text", text: markdown }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
