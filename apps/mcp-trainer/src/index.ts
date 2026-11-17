import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_URL = process.env.GOALSPLIT_API_URL ?? "http://localhost:3001/api";
// Required once the API has API_KEY set (always, in production). Not needed
// against a local dev API with no key configured.
const API_KEY = process.env.GOALSPLIT_API_KEY;

const server = new McpServer({
  name: "goalsplit-trainer",
  version: "0.3.0",
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

// PUT a JSON body to a GoalSplit API path and return the parsed `data`.
async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...(API_KEY ? { "x-api-key": API_KEY } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`GoalSplit API request failed: ${res.status} ${await res.text()}`);
  }
  return ((await res.json()) as { data: T }).data;
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

server.registerTool(
  "get_plan_adherence",
  {
    title: "Get training-plan adherence",
    description:
      "Progress against the athlete's 13-week training-plan study (research Proposal 3, 9 Nov 2026 – 7 Feb 2027): " +
      "the 7 pre-registered 'did I follow the plan?' criteria (no 14+ day break, no collapsed week, 2+ deloads, weekend " +
      "75+ min runs in 10 of 13 weeks, quality sessions in 9 of 13, 80%+ easy, a 10% build), each with a status " +
      "(met / on-track / at-risk / missed / pending), plus a week-by-week grid. Tracks the plan; it isn't the plan.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async () => {
    const markdown = await apiGet("/plan/adherence", { format: "markdown" });
    return { content: [{ type: "text", text: markdown }] };
  },
);

server.registerTool(
  "save_weekly_note",
  {
    title: "Save weekly coaching note",
    description:
      "Saves a markdown coaching note for one week to GoalSplit, where it shows on the dashboard. One note per week: " +
      "saving again for the same week replaces it. Only save when the athlete has asked for a weekly review.",
    inputSchema: {
      week_start: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .describe("Monday (YYYY-MM-DD) of the week the note reviews — normally the last complete week."),
      markdown: z.string().min(1).max(8000).describe("The note, in markdown. Keep it under ~400 words."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ week_start, markdown }) => {
    const note = await apiPut<{ weekStart: string; updatedAt: string }>(`/plan/notes/${week_start}`, { body: markdown });
    return { content: [{ type: "text", text: `Saved the note for the week of ${note.weekStart} (${note.updatedAt}).` }] };
  },
);

const REVIEW_INSTRUCTIONS = `You are reviewing this runner's training week. They are partway through a pre-registered 13-week training-plan study (9 Nov 2026 – 7 Feb 2027), so your job is to describe and check, not to coach: don't prescribe sessions or change the plan, because that would change what the study is testing.

1. Call get_weekly_review (weeks: 4), get_plan_adherence, and get_recent_training_data (days: 7) for the individual sessions and any notes the athlete wrote.
2. Review the last complete week (Monday–Sunday) with these sections, kept tight (under ~400 words):
   - **Headline**: one or two sentences on how the week went.
   - **Plan check**: the adherence criteria that moved this week, anything at risk or missed, and what the plan's own rules need from the coming weeks (e.g. "a weekend 75+ min run is needed every remaining week"). State requirements; don't design sessions.
   - **Load & form**: weekly TRIMP vs recent weeks, CTL ramp, TSB and ACWR band, monotony.
   - **Intensity**: the low/moderate/high split.
   - **Aerobic efficiency**: EF, Z2 pace, long-run decoupling/fade. Treat these as trends, not single-week verdicts.
   - **Recovery**: resting HR vs baseline (flag elevated mornings), sleep amount and timing, Body Battery, readiness.
   - **What to watch**: signals worth keeping an eye on next week. Say "nothing notable" if there are none.
3. Rules:
   - Cite the actual numbers. Compare against the athlete's own history and baselines, not population norms.
   - Respect the data-quality caveats. Don't judge the current partial week's totals as a full week.
   - Don't invent metrics the data doesn't contain (there is no HRV or temperature data).
   - Where training and recovery signals disagree, say so.
   - When comparing a race or effort with a target, compare pace per km (recorded distances often differ from the nominal one) and check the arithmetic.
   - If a recovery signal looks like illness or injury, say so plainly: health comes before the study.
4. Show the review to the athlete, then save it with save_weekly_note (week_start = that week's Monday) so it appears on their dashboard.`;

server.registerPrompt(
  "weekly_review",
  {
    title: "Weekly training review",
    description: "Review of the last complete week: plan adherence, training load and recovery, saved to the dashboard.",
    argsSchema: {
      focus: z
        .string()
        .optional()
        .describe("Optional emphasis, e.g. 'recovery', 'the long runs', 'the 10K race'."),
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
