import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_URL = process.env.GOALSPLIT_API_URL ?? "http://localhost:3001/api";
// Required once the API has API_KEY set (always, in production). Not needed
// against a local dev API with no key configured.
const API_KEY = process.env.GOALSPLIT_API_KEY;

const server = new McpServer({
  name: "goalsplit-trainer",
  version: "0.2.0",
});

// GET a GoalSplit API path and return the body as text (both endpoints used
// here return markdown).
async function apiGet(path: string, params: Record<string, string | number | undefined>): Promise<string> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const res = await fetch(`${API_URL}${path}?${query}`, {
    headers: API_KEY ? { "x-api-key": API_KEY } : {},
  });
  if (!res.ok) {
    throw new Error(`GoalSplit API request failed: ${res.status} ${await res.text()}`);
  }
  return res.text();
}

server.registerTool(
  "get_recent_training_data",
  {
    title: "Get recent training data",
    description:
      "Fetches the user's recent GoalSplit training log (runs and other activities synced from Strava), " +
      "including per-activity distance, pace, grade-adjusted pace, heart rate, elevation, run type " +
      "(easy/long/workout/recovery/race), training load (Banister TRIMP), splits, best efforts, and any notes — " +
      "for use as coaching context. This is per-session detail; use get_weekly_review for the computed " +
      "load, intensity, efficiency and recovery trends.",
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
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ days, type }) => {
    const markdown = await apiGet("/activities/export", { format: "markdown", days, type });
    return { content: [{ type: "text", text: markdown }] };
  },
);

server.registerTool(
  "get_weekly_review",
  {
    title: "Get weekly training & recovery review",
    description:
      "Fetches a week-by-week digest of the athlete's GoalSplit Training and Recovery pages: current fitness/fatigue/form " +
      "(CTL/ATL/TSB), ACWR band, weekly TRIMP, monotony and strain, 3-zone intensity distribution and polarization index, " +
      "aerobic efficiency (EF) and Z2 pace, the week's long run with decoupling and pace fade, the current training phase, " +
      "today's readiness score, and Garmin recovery by week (resting HR vs the athlete's own baseline, elevated mornings, " +
      "sleep, bedtime consistency, Body Battery, rest stress). Includes a last-week-vs-prior comparison, interpretation " +
      "thresholds and data-quality caveats. Use it as the basis for weekly coaching feedback.",
    inputSchema: {
      weeks: z
        .number()
        .int()
        .min(1)
        .max(12)
        .optional()
        .describe("Calendar weeks to include, ending with the current (partial) week. Defaults to 4."),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ weeks }) => {
    const markdown = await apiGet("/training/weekly-review", { weeks });
    return { content: [{ type: "text", text: markdown }] };
  },
);

const REVIEW_INSTRUCTIONS = `You are acting as this runner's coach. Write their weekly training feedback.

1. Call get_weekly_review (weeks: 4) for the analytics, then get_recent_training_data (days: 7) for the individual sessions and any notes the athlete wrote.
2. Write the feedback with these sections, kept tight:
   - **Headline**: one or two sentences on how the week went and where they stand.
   - **Load & form**: weekly TRIMP vs recent weeks, CTL ramp, TSB and ACWR band, monotony.
   - **Intensity balance**: low/moderate/high split and whether it suits easy-base vs. quality work.
   - **Aerobic efficiency**: EF, Z2 pace, long-run decoupling/fade. Treat these as trends, not single-week verdicts.
   - **Recovery**: resting HR vs baseline (flag any elevated mornings), sleep amount and timing, Body Battery, readiness.
   - **Flags**: anything that needs attention (load spikes, high monotony, recovery markers moving the wrong way). Say "none" if nothing does.
   - **Next week**: 2–3 concrete, specific suggestions (sessions, volume, recovery habits).
3. Rules:
   - Cite the actual numbers. Compare against the athlete's own history and baselines, not population norms.
   - Respect the data-quality caveats. Don't judge the current partial week's totals as a full week.
   - Don't invent metrics the data doesn't contain (there is no HRV or temperature data).
   - Where training and recovery signals disagree, say so and explain which you'd weight more and why.`;

server.registerPrompt(
  "weekly_review",
  {
    title: "Weekly training review",
    description: "Coaching feedback on the last week of training and recovery, from GoalSplit's analytics.",
    argsSchema: {
      focus: z
        .string()
        .optional()
        .describe("Optional emphasis, e.g. 'half marathon in 6 weeks', 'recovery', 'building base'."),
    },
  },
  ({ focus }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: focus ? `${REVIEW_INSTRUCTIONS}\n\nThe athlete wants the feedback to focus on: ${focus}` : REVIEW_INSTRUCTIONS,
        },
      },
    ],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
