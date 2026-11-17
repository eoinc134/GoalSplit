import { describe, it, expect } from "vitest";
import type { DailyLoadPoint, PlanAdherence } from "@goalsplit/types";
import { buildPlanAdherence } from "./plan-adherence";
import { addDaysUtc } from "./dates";
import { computeActivityMetrics } from "./activity-metrics";
import { buildZoneBoundariesKarvonen } from "./hr-zones";
import type { AnalyticsActivity } from "./analytics-activity";
import { syntheticStreams } from "./__fixtures__/streams";

const ZONES = buildZoneBoundariesKarvonen(190, 50);
const START = "2026-11-09"; // Monday, week 1

let seq = 0;
function run(date: string, km: number, minutes: number, opts: { workout?: boolean; hr?: number } = {}): AnalyticsActivity {
  const metrics =
    opts.hr !== undefined
      ? computeActivityMetrics(syntheticStreams({ seconds: minutes * 60, speedMs: (km * 1000) / (minutes * 60), hr: opts.hr }), {
          isRun: true,
          summaryDistanceM: km * 1000,
        })
      : null;
  return {
    id: `a${++seq}`,
    name: "Run",
    type: "Run",
    localDate: date,
    movingTimeS: minutes * 60,
    distanceM: km * 1000,
    elevationGainM: 0,
    averageHeartrate: null,
    workoutType: opts.workout ? 3 : null,
    isWeekLongest: false,
    metrics,
  };
}

// A daily series from the activities: just the activity counts and a nominal load.
function dailyFor(activities: AnalyticsActivity[], from: string, to: string): DailyLoadPoint[] {
  const out: DailyLoadPoint[] = [];
  for (let d = from; d <= to; d = addDaysUtc(d, 1)) {
    const n = activities.filter((a) => a.localDate === d).length;
    out.push({ date: d, load: n * 50, activityCount: n, scoredCount: n, atl: 0, ctl: 0, tsb: 0, acwr: null });
  }
  return out;
}

// Three trailing weeks of 40 km (four 10 km runs each) before the study.
function trailing(): AnalyticsActivity[] {
  const out: AnalyticsActivity[] = [];
  for (let w = 3; w >= 1; w--) {
    const monday = addDaysUtc(START, -7 * w);
    for (const offset of [0, 2, 4, 6]) out.push(run(addDaysUtc(monday, offset), 10, 55));
  }
  return out;
}

function adherence(activities: AnalyticsActivity[], today: string): PlanAdherence {
  const sorted = [...activities].sort((a, b) => a.localDate.localeCompare(b.localDate));
  return buildPlanAdherence({ activities: sorted, daily: dailyFor(sorted, addDaysUtc(START, -21), today), zones: ZONES, todayLocal: today });
}

const crit = (p: PlanAdherence, key: string) => p.criteria.find((c) => c.key === key)!;

describe("buildPlanAdherence", () => {
  it("reports week 2 progress with the current week counted once a long run is done", () => {
    const acts = [
      ...trailing(),
      run("2026-11-10", 10, 55, { hr: 140 }),
      run("2026-11-12", 8, 45, { workout: true }), // quality, no HR → trust the class
      run("2026-11-14", 16, 90, { hr: 140 }), // Saturday 90 min
      run("2026-11-16", 10, 55),
    ];
    const p = adherence(acts, "2026-11-18");

    expect(p.status).toBe("in-progress");
    expect(p.weekNumber).toBe(2);
    expect(p.weeks[0]).toMatchObject({ state: "complete", km: 34, weekendLongRun: true, quality: true, kind: "deload" });
    expect(p.weeks[0].kmVsTrailing).toBeCloseTo(0.85, 2);
    expect(p.weeks[1]).toMatchObject({ state: "current", kind: null });
    expect(crit(p, "long_runs")).toMatchObject({ value: 1, status: "on-track", detail: "1 of 10 needed — can miss 3 more weeks" });
    expect(crit(p, "quality")).toMatchObject({ value: 1, status: "on-track" });
    expect(crit(p, "deloads")).toMatchObject({ value: 1, status: "on-track" });
    expect(crit(p, "easy")).toMatchObject({ value: 100, status: "on-track" });
    expect(crit(p, "build")).toMatchObject({ status: "pending" });
    expect(crit(p, "no_break")).toMatchObject({ status: "on-track", detail: "Last activity 2 days ago" });
    expect(p.onTrack).toBe(true);
  });

  it("flags a growing gap, then a 14+ day break", () => {
    const acts = [...trailing(), run("2026-11-10", 10, 55)];
    expect(crit(adherence(acts, "2026-11-18"), "no_break")).toMatchObject({ status: "at-risk" });
    const broken = adherence(acts, "2026-11-25");
    expect(crit(broken, "no_break")).toMatchObject({ status: "missed", value: 1 });
    expect(broken.onTrack).toBe(false);
  });

  it("marks a week under 50% of the trailing three as a collapse", () => {
    const acts = [...trailing(), run("2026-11-10", 10, 55), run("2026-11-12", 5, 30)];
    const p = adherence(acts, "2026-11-17");
    expect(p.weeks[0].kind).toBe("collapse");
    expect(crit(p, "no_collapse")).toMatchObject({ status: "missed", value: 1 });
  });

  it("calls a count criterion missed once the remaining weeks can't reach it", () => {
    // Four complete weeks with no weekend long run: 0 + 9 open < 10.
    const acts = [...trailing()];
    for (let w = 0; w < 4; w++) for (const offset of [0, 2, 4]) acts.push(run(addDaysUtc(START, 7 * w + offset), 12, 60));
    const p = adherence(acts, addDaysUtc(START, 28)); // Monday of week 5
    expect(crit(p, "long_runs")).toMatchObject({ value: 0, status: "missed" });
  });

  it("scores the build once weeks 6–9 are complete, and finishes with met/missed only", () => {
    const acts = [...trailing()];
    for (let w = 0; w < 13; w++) {
      const km = w < 4 ? 30 : 36; // 1.2× from week 5 on
      for (const offset of [0, 2, 5]) acts.push(run(addDaysUtc(START, 7 * w + offset), km / 3, 60, { workout: offset === 2 }));
    }
    const mid = adherence(acts, addDaysUtc(START, 7 * 8 + 2)); // week 9, partial
    expect(crit(mid, "build")).toMatchObject({ status: "pending" });
    expect(crit(mid, "build").detail).toContain("33 km/week");

    const done = adherence(acts, "2027-02-10");
    expect(done.status).toBe("finished");
    expect(done.weekNumber).toBeNull();
    expect(crit(done, "build")).toMatchObject({ status: "met", value: 1.2 });
    expect(done.criteria.every((c) => c.status === "met" || c.status === "missed" || c.status === "pending")).toBe(true);
    expect(crit(done, "quality")).toMatchObject({ value: 13, status: "met" });
    expect(crit(done, "long_runs")).toMatchObject({ value: 0, status: "missed" }); // 60 min, not 75
  });

  it("is all pending before the study starts", () => {
    const p = adherence(trailing(), "2026-11-05");
    expect(p.status).toBe("not-started");
    expect(p.criteria.every((c) => c.status === "pending")).toBe(true);
    expect(p.weeks.every((w) => w.state === "future")).toBe(true);
  });
});
