import { describe, it, expect } from "vitest";
import type { AthletePhysiology } from "@goalsplit/types";
import {
  buildDailySeries,
  buildTrainingLoadSummary,
  buildWeekly,
  classifyBand,
  monotony,
  strain,
  type LoadInput,
} from "./training-load";
import { addDaysUtc } from "./dates";

const TODAY = "2026-09-09"; // a Wednesday

const PHYSIOLOGY: AthletePhysiology = {
  hrMax: 190,
  hrRest: 50,
  hrRestSource: "garmin",
  sex: null,
  trimpCoefficient: 1.92,
  zoneModel: "karvonen",
  zones: [],
};

function everyDay(from: string, days: number, load: number): LoadInput[] {
  return Array.from({ length: days }, (_, i) => ({ localDate: addDaysUtc(from, i), load, source: "stream" as const }));
}

describe("buildDailySeries", () => {
  it("emits one row per day including rest days", () => {
    const series = buildDailySeries([{ localDate: "2026-09-02", load: 80, source: "stream" }], "2026-09-01", "2026-09-05");
    expect(series.map((d) => d.date)).toEqual(["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"]);
    expect(series.map((d) => d.load)).toEqual([0, 80, 0, 0, 0]);
  });

  it("converges ATL and CTL to a constant daily load", () => {
    const series = buildDailySeries(everyDay("2026-01-01", 400, 50), "2026-01-01", addDaysUtc("2026-01-01", 399));
    const last = series[series.length - 1];
    expect(last.atl).toBeCloseTo(50, 3);
    expect(last.ctl).toBeCloseTo(50, 1);
    expect(last.tsb).toBeCloseTo(0, 0);
    expect(last.acwr).toBeCloseTo(1, 2);
  });

  it("drops ATL faster than CTL after training stops, so form turns positive", () => {
    const series = buildDailySeries(everyDay("2026-01-01", 120, 60), "2026-01-01", addDaysUtc("2026-01-01", 134));
    const last = series[series.length - 1];
    expect(last.atl).toBeLessThan(last.ctl);
    expect(last.tsb).toBeGreaterThan(0);
  });

  it("uses yesterday's CTL − ATL as today's form", () => {
    const series = buildDailySeries([{ localDate: "2026-09-01", load: 100, source: "stream" }], "2026-09-01", "2026-09-02");
    expect(series[0].tsb).toBe(0);
    expect(series[1].tsb).toBeCloseTo(series[0].ctl - series[0].atl);
  });

  it("counts scored vs unscored activities", () => {
    const series = buildDailySeries(
      [
        { localDate: "2026-09-01", load: 50, source: "stream" },
        { localDate: "2026-09-01", load: 30, source: "average-hr" },
        { localDate: "2026-09-01", load: 0, source: "none" },
      ],
      "2026-09-01",
      "2026-09-01",
    );
    expect(series[0]).toMatchObject({ load: 80, activityCount: 3, scoredCount: 2 });
  });

  it("leaves ACWR null until any load has been recorded", () => {
    expect(buildDailySeries([], "2026-09-01", "2026-09-03").every((d) => d.acwr === null)).toBe(true);
  });
});

describe("classifyBand", () => {
  it("maps ratios to the Gabbett bands", () => {
    expect(classifyBand(null)).toBeNull();
    expect(classifyBand(0.79)).toBe("undertraining");
    expect(classifyBand(1.0)).toBe("sweet-spot");
    expect(classifyBand(1.3)).toBe("sweet-spot");
    expect(classifyBand(1.4)).toBe("caution");
    expect(classifyBand(1.6)).toBe("high-risk");
  });
});

describe("monotony and strain (Foster)", () => {
  it("is mean ÷ SD of daily loads", () => {
    const loads = [100, 0, 100, 0, 100, 0, 100];
    const mean = 400 / 7;
    const sd = Math.sqrt(loads.reduce((s, v) => s + (v - mean) ** 2, 0) / 7);
    expect(monotony(loads)).toBeCloseTo(mean / sd, 6);
    expect(strain(loads)).toBeCloseTo(400 * (mean / sd), 6);
  });

  it("is higher for the same weekly load spread evenly than with rest days", () => {
    expect(monotony([60, 60, 50, 60, 60, 50, 60])!).toBeGreaterThan(monotony([120, 0, 100, 0, 120, 0, 80])!);
  });

  it("is null when every day is identical", () => {
    expect(monotony([0, 0, 0, 0, 0, 0, 0])).toBeNull();
    expect(strain([50, 50, 50])).toBeNull();
  });
});

describe("buildWeekly", () => {
  it("returns 12 Monday-aligned weeks, flagging the current one as partial", () => {
    const daily = buildDailySeries(everyDay("2026-06-01", 101, 40), "2026-06-01", TODAY);
    const weekly = buildWeekly(daily, TODAY);
    expect(weekly).toHaveLength(12);
    expect(weekly[11]).toMatchObject({ weekStart: "2026-09-07", isPartialWeek: true, load: 120 });
    expect(weekly[10]).toMatchObject({ weekStart: "2026-08-31", isPartialWeek: false, load: 280 });
  });
});

describe("buildTrainingLoadSummary", () => {
  it("returns the display window but computes from the first activity", () => {
    const inputs = everyDay("2026-01-01", 252, 50);
    const summary = buildTrainingLoadSummary({
      inputs,
      physiology: PHYSIOLOGY,
      todayLocal: TODAY,
      firstActivityLocalDate: "2026-01-01",
      displayDays: 90,
    });
    expect(summary.daily).toHaveLength(90);
    expect(summary.daily[89].date).toBe(TODAY);
    // Long history means CTL has already warmed up inside the window.
    expect(summary.daily[0].ctl).toBeGreaterThan(40);
    expect(summary.insufficientHistory).toBe(false);
    expect(summary.current.load7d).toBe(350);
    expect(summary.coverage).toMatchObject({ activityCount: 7, streamScored: 7, coveragePct: 100 });
  });

  it("flags insufficient history under 42 days and handles no activities at all", () => {
    const summary = buildTrainingLoadSummary({
      inputs: [],
      physiology: PHYSIOLOGY,
      todayLocal: TODAY,
      firstActivityLocalDate: null,
      displayDays: 28,
    });
    expect(summary.daily).toHaveLength(28);
    expect(summary.insufficientHistory).toBe(true);
    expect(summary.current.acwr).toBeNull();
    expect(summary.coverage.coveragePct).toBeNull();
    expect(summary.lowCoverage).toBe(false);
  });

  it("flags low coverage when most recent activities have no HR", () => {
    const summary = buildTrainingLoadSummary({
      inputs: [
        { localDate: TODAY, load: 0, source: "none" },
        { localDate: TODAY, load: 0, source: "none" },
        { localDate: TODAY, load: 40, source: "average-hr" },
      ],
      physiology: PHYSIOLOGY,
      todayLocal: TODAY,
      firstActivityLocalDate: "2026-01-01",
      displayDays: 28,
    });
    expect(summary.coverage).toMatchObject({ averageScored: 1, unscored: 2, coveragePct: 33 });
    expect(summary.lowCoverage).toBe(true);
  });
});
