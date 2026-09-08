import { describe, it, expect } from "vitest";
import {
  buildLoadSpine,
  summarizeWindow,
  computeAcwr,
  classifyBand,
  buildTrainingLoadSummary,
  type ActivityLoadInput,
  type ListPayloadByActivityId,
} from "./training-load";

const TODAY = "2026-09-08";

describe("buildLoadSpine", () => {
  it("returns 28 rows ending on todayLocal, oldest first", () => {
    const spine = buildLoadSpine([], {}, TODAY);
    expect(spine).toHaveLength(28);
    expect(spine[0].date).toBe("2026-08-12");
    expect(spine[27].date).toBe(TODAY);
  });

  it("fills rest days with zero load instead of dropping them", () => {
    const spine = buildLoadSpine([], {}, TODAY);
    expect(spine.every((d) => d.load === 0 && d.activityCount === 0 && d.scoredCount === 0)).toBe(true);
  });

  it("sums suffer_score into the matching date and counts scored vs unscored activities", () => {
    const activities: ActivityLoadInput[] = [
      { id: "a1", localDate: TODAY },
      { id: "a2", localDate: TODAY },
      { id: "a3", localDate: TODAY },
    ];
    const payloads: ListPayloadByActivityId = {
      a1: { suffer_score: 50 },
      a2: { suffer_score: 30 },
      a3: {}, // no suffer_score key at all — activity still counts, load doesn't
    };
    const spine = buildLoadSpine(activities, payloads, TODAY);
    const today = spine[27];
    expect(today.load).toBe(80);
    expect(today.activityCount).toBe(3);
    expect(today.scoredCount).toBe(2);
  });

  it("treats a genuine suffer_score of 0 as scored, not missing", () => {
    const activities: ActivityLoadInput[] = [{ id: "a1", localDate: TODAY }];
    const spine = buildLoadSpine(activities, { a1: { suffer_score: 0 } }, TODAY);
    const today = spine[27];
    expect(today.load).toBe(0);
    expect(today.activityCount).toBe(1);
    expect(today.scoredCount).toBe(1);
  });
});

describe("summarizeWindow", () => {
  it("sums the trailing N days of the spine", () => {
    const spine = buildLoadSpine(
      [
        { id: "a1", localDate: TODAY },
        { id: "a2", localDate: "2026-08-30" }, // 9 days back — inside chronic, outside acute
      ],
      { a1: { suffer_score: 20 }, a2: { suffer_score: 40 } },
      TODAY,
    );

    const acute = summarizeWindow(spine, 7);
    const chronic = summarizeWindow(spine, 28);

    expect(acute.totalLoad).toBe(20);
    expect(chronic.totalLoad).toBe(60);
    expect(chronic.avgLoad).toBe(60 / 28);
  });

  it("returns a null coveragePct when there are no activities in the window", () => {
    const spine = buildLoadSpine([], {}, TODAY);
    expect(summarizeWindow(spine, 7).coveragePct).toBeNull();
  });

  it("computes coveragePct as a percentage of scored activities", () => {
    const activities: ActivityLoadInput[] = [
      { id: "a1", localDate: TODAY },
      { id: "a2", localDate: TODAY },
    ];
    const spine = buildLoadSpine(activities, { a1: { suffer_score: 10 } }, TODAY);
    expect(summarizeWindow(spine, 7).coveragePct).toBe(50);
  });
});

describe("computeAcwr", () => {
  it("returns null when chronic average load is 0", () => {
    const zero = { days: 28, totalLoad: 0, avgLoad: 0, activityCount: 0, scoredCount: 0, coveragePct: null };
    expect(computeAcwr(zero, zero)).toBeNull();
  });

  it("divides acute avg by chronic avg", () => {
    const acute = { days: 7, totalLoad: 70, avgLoad: 10, activityCount: 1, scoredCount: 1, coveragePct: 100 };
    const chronic = { days: 28, totalLoad: 140, avgLoad: 5, activityCount: 2, scoredCount: 2, coveragePct: 100 };
    expect(computeAcwr(acute, chronic)).toBe(2);
  });
});

describe("classifyBand", () => {
  it("returns null for a null acwr", () => expect(classifyBand(null)).toBeNull());
  it("classifies undertraining below 0.8", () => expect(classifyBand(0.79)).toBe("undertraining"));
  it("classifies the sweet spot from 0.8 to 1.3 inclusive", () => {
    expect(classifyBand(0.8)).toBe("sweet-spot");
    expect(classifyBand(1.3)).toBe("sweet-spot");
  });
  it("classifies caution above 1.3 up to 1.5 inclusive", () => {
    expect(classifyBand(1.31)).toBe("caution");
    expect(classifyBand(1.5)).toBe("caution");
  });
  it("classifies high-risk above 1.5", () => expect(classifyBand(1.51)).toBe("high-risk"));
});

describe("buildTrainingLoadSummary", () => {
  it("handles a brand new connection with no activities at all", () => {
    const summary = buildTrainingLoadSummary({
      activities: [],
      listPayloadByActivityId: {},
      todayLocal: TODAY,
      firstActivityLocalDate: null,
    });
    expect(summary.acwr).toBeNull();
    expect(summary.band).toBeNull();
    expect(summary.insufficientHistory).toBe(true);
    expect(summary.lowCoverage).toBe(false); // no data isn't the same as low-coverage data
  });

  it("flags insufficientHistory when the account is younger than 28 days", () => {
    const summary = buildTrainingLoadSummary({
      activities: [{ id: "a1", localDate: TODAY }],
      listPayloadByActivityId: { a1: { suffer_score: 50 } },
      todayLocal: TODAY,
      firstActivityLocalDate: "2026-09-01", // 7 days of history
    });
    expect(summary.insufficientHistory).toBe(true);
  });

  it("clears insufficientHistory once there are at least 28 days of history", () => {
    const summary = buildTrainingLoadSummary({
      activities: [{ id: "a1", localDate: TODAY }],
      listPayloadByActivityId: { a1: { suffer_score: 50 } },
      todayLocal: TODAY,
      firstActivityLocalDate: "2026-08-12", // exactly 28 days of history
    });
    expect(summary.insufficientHistory).toBe(false);
  });

  it("flags lowCoverage when fewer than half of the acute window's activities have a suffer_score", () => {
    const activities: ActivityLoadInput[] = [
      { id: "a1", localDate: TODAY },
      { id: "a2", localDate: TODAY },
      { id: "a3", localDate: TODAY },
    ];
    const summary = buildTrainingLoadSummary({
      activities,
      listPayloadByActivityId: { a1: { suffer_score: 50 } }, // 1 of 3 scored
      todayLocal: TODAY,
      firstActivityLocalDate: "2026-08-01",
    });
    expect(summary.lowCoverage).toBe(true);
  });

  it("produces a complete summary with a sensible band for typical data", () => {
    const activities: ActivityLoadInput[] = [
      { id: "a1", localDate: TODAY },
      { id: "a2", localDate: "2026-08-20" },
    ];
    const summary = buildTrainingLoadSummary({
      activities,
      listPayloadByActivityId: { a1: { suffer_score: 70 }, a2: { suffer_score: 70 } },
      todayLocal: TODAY,
      firstActivityLocalDate: "2026-08-01",
    });
    expect(summary.daily).toHaveLength(28);
    expect(summary.acwr).not.toBeNull();
    expect(summary.band).not.toBeNull();
  });
});
