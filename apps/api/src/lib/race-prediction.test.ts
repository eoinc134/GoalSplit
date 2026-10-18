import { describe, it, expect } from "vitest";
import type { RoadRace } from "@goalsplit/types";
import {
  buildRacePredictions,
  distanceFromName,
  levelBefore,
  officialTimeFromName,
  raceDistance,
  selectRoadRaces,
  timeForVdot,
  vdot,
} from "./race-prediction";
import type { AnalyticsActivity } from "./analytics-activity";

function race(localDate: string, distanceM: number, timeS: number, name = "Race"): RoadRace {
  return {
    activityId: `${localDate}-${distanceM}`,
    name,
    localDate,
    distanceM,
    distanceSource: "title",
    timeS,
    timeSource: "moving",
    vdot: vdot(distanceM, timeS),
  };
}

function activity(overrides: Partial<AnalyticsActivity>): AnalyticsActivity {
  return {
    id: "a",
    name: "Pisa 10k",
    type: "Run",
    localDate: "2026-10-11",
    movingTimeS: 2665,
    distanceM: 10_672,
    elevationGainM: 22,
    averageHeartrate: 198,
    workoutType: 1,
    isWeekLongest: false,
    metrics: null,
    ...overrides,
  };
}

describe("VDOT", () => {
  it("matches Daniels' tables", () => {
    expect(vdot(5000, 20 * 60)).toBeCloseTo(49.8, 1);
    expect(vdot(42195, 3 * 3600)).toBeCloseTo(53.5, 1);
  });

  it("inverts exactly", () => {
    const v = vdot(10_000, 2400);
    expect(timeForVdot(10_000, v)).toBeCloseTo(2400, 3);
  });
});

describe("reading races from titles", () => {
  it("prefers the title's distance over GPS", () => {
    expect(raceDistance("Pisa 10k", 10_672.7)).toEqual({ distanceM: 10_000, source: "title" });
    expect(raceDistance("Firenze Half Marathon", 21_137)).toEqual({ distanceM: 21_097.5, source: "title" });
    expect(raceDistance("Lucca Parkrun", 5_036)).toEqual({ distanceM: 5000, source: "title" });
    expect(raceDistance("Morning Run", 20_335)).toEqual({ distanceM: 21_097.5, source: "standard" });
    expect(raceDistance("Wing for Life", 28_083)).toEqual({ distanceM: 28_083, source: "gps" });
    expect(distanceFromName("Venice Marathon")).toBe(42_195);
  });

  it("reads an official time in brackets", () => {
    expect(officialTimeFromName("Pisa 10 - Forgot to stop my watch (47:50)")).toBe(2870);
    expect(officialTimeFromName("Venice Marathon (3:31:05)")).toBe(12_665);
    expect(officialTimeFromName("Easy run")).toBeNull();
  });
});

describe("selectRoadRaces", () => {
  it("keeps tagged road races and uses title distance and time", () => {
    const [r] = selectRoadRaces([activity({ name: "Pisa 10 (47:50)", distanceM: 10_519 })], 214);
    expect(r).toMatchObject({ distanceM: 10_000, distanceSource: "standard", timeS: 2870, timeSource: "title" });
  });

  it("drops untagged, hilly, ultra-length and easy-effort 'races'", () => {
    const kept = selectRoadRaces(
      [
        activity({ id: "untagged", workoutType: 0 }),
        activity({ id: "trail", elevationGainM: 500, distanceM: 18_000 }),
        activity({ id: "ultra", distanceM: 52_000 }),
        activity({ id: "charity walk", averageHeartrate: 109 }),
        activity({ id: "no hr", averageHeartrate: null }),
      ],
      214,
    );
    expect(kept.map((r) => r.activityId)).toEqual(["no hr"]);
  });
});

describe("levelBefore", () => {
  it("uses the median VDOT of races in the last 180 days", () => {
    const races = [race("2026-01-10", 5000, 1200), race("2026-03-01", 10000, 2500), race("2026-04-01", 5000, 1260)];
    const level = levelBefore(races, "2026-05-01")!;
    // VDOTs ≈ 49.8, 49.5, 47.0 → the median is the 10K
    expect(level.vdot).toBeCloseTo(vdot(10000, 2500), 6);
    expect(level.stale).toBe(false);
  });

  it("falls back to the most recent race, flagged stale, when none are recent", () => {
    const level = levelBefore([race("2024-01-10", 5000, 1200)], "2026-05-01")!;
    expect(level.stale).toBe(true);
    expect(level.basedOn).toHaveLength(1);
  });

  it("returns null with no prior races", () => {
    expect(levelBefore([], "2026-05-01")).toBeNull();
  });
});

describe("buildRacePredictions", () => {
  it("backtests each race on earlier races only, and learns a shrunk per-distance adjustment", () => {
    // Steady fitness, but this runner's marathon is 20% slower than VDOT predicts.
    const races = [
      race("2026-01-10", 5000, 1200),
      race("2026-02-10", 10000, timeForVdot(10000, vdot(5000, 1200))),
      race("2026-03-10", 42195, timeForVdot(42195, vdot(5000, 1200)) * 1.2),
      race("2026-04-10", 5000, 1200),
    ];
    const summary = buildRacePredictions(races, "2026-05-01");

    expect(summary.backtest).toHaveLength(3);
    expect(summary.backtest.find((b) => b.distanceM === 42195)!.errorPct).toBeCloseTo((1 / 1.2 - 1) * 100, 1);
    const marathon = summary.predictions.find((p) => p.label === "Marathon")!;
    expect(marathon.historyCount).toBe(1);
    // One race moves the prediction halfway: exp(ln(1.2) / 2) ≈ +9.5%
    expect(marathon.adjustmentPct).toBeCloseTo((Math.sqrt(1.2) - 1) * 100, 1);
    const half = summary.predictions.find((p) => p.label === "Half marathon")!;
    expect(half.adjustedTimeS).toBeNull();
    expect(summary.typicalErrorPct).not.toBeNull();
  });

  it("returns no predictions without any race", () => {
    const summary = buildRacePredictions([], "2026-05-01");
    expect(summary.level).toBeNull();
    expect(summary.predictions).toEqual([]);
  });
});
