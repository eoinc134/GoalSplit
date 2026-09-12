import { describe, it, expect } from "vitest";
import {
  extractBestEfforts,
  computeStravaBests,
  buildPrRecords,
  normalizeDistanceKey,
  validateManualPrInput,
  type DetailDumpRow,
} from "./personal-records";
import type { ManualPrEntry } from "@goalsplit/types";

function makeDumpRow(overrides: Partial<DetailDumpRow> = {}): DetailDumpRow {
  return {
    activity_id: "act-1",
    strava_id: 1,
    name: "Morning Run",
    local_date: "2026-06-01",
    best_efforts: [],
    ...overrides,
  };
}

function makeManualEntry(overrides: Partial<ManualPrEntry> = {}): ManualPrEntry {
  return {
    id: "m-1",
    distanceLabel: "10K",
    timeSeconds: 2400,
    achievedDate: "2026-01-01",
    notes: null,
    sourceActivityId: null,
    sourceActivityName: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("normalizeDistanceKey", () => {
  it("collapses whitespace and hyphen variance", () => {
    expect(normalizeDistanceKey("Half-Marathon")).toBe(normalizeDistanceKey("Half  Marathon"));
    expect(normalizeDistanceKey(" 10K ")).toBe("10k");
  });
});

describe("extractBestEfforts", () => {
  it("returns nothing when best_efforts is missing or not an array", () => {
    expect(extractBestEfforts(makeDumpRow({ best_efforts: undefined }))).toEqual([]);
    expect(extractBestEfforts(makeDumpRow({ best_efforts: { name: "5K" } }))).toEqual([]);
  });

  it("extracts well-formed entries", () => {
    const row = makeDumpRow({ best_efforts: [{ name: "5K", elapsed_time: 1200 }] });
    const result = extractBestEfforts(row);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ activityId: "act-1", timeSeconds: 1200, achievedDate: "2026-06-01" });
  });

  it("rejects malformed entries (missing/wrong-typed fields)", () => {
    const row = makeDumpRow({
      best_efforts: [
        { name: "5K" }, // no elapsed_time
        { elapsed_time: 1200 }, // no name
        { name: 5, elapsed_time: 1200 }, // wrong type
        null,
      ],
    });
    expect(extractBestEfforts(row)).toEqual([]);
  });

  it("rejects a zero or negative elapsed_time so it can never win a PR", () => {
    const row = makeDumpRow({
      best_efforts: [
        { name: "5K", elapsed_time: 0 },
        { name: "10K", elapsed_time: -5 },
      ],
    });
    expect(extractBestEfforts(row)).toEqual([]);
  });
});

describe("computeStravaBests", () => {
  it("ignores pr_rank entirely and recomputes the true minimum across all dumps", () => {
    // An older activity's stale, snapshotted pr_rank could say it's still #1 —
    // this function never reads pr_rank, so a later faster run always wins.
    const rows: DetailDumpRow[] = [
      makeDumpRow({
        activity_id: "act-old",
        local_date: "2026-01-01",
        best_efforts: [{ name: "5K", elapsed_time: 1300, pr_rank: 1 }],
      }),
      makeDumpRow({
        activity_id: "act-new",
        local_date: "2026-06-01",
        best_efforts: [{ name: "5K", elapsed_time: 1150, pr_rank: null }],
      }),
    ];

    const best = computeStravaBests(rows);
    expect(best.get("5k")?.timeSeconds).toBe(1150);
    expect(best.get("5k")?.activityId).toBe("act-new");
  });

  it("groups by normalized key across formatting variance", () => {
    const rows: DetailDumpRow[] = [
      makeDumpRow({ best_efforts: [{ name: "Half-Marathon", elapsed_time: 5000 }] }),
      makeDumpRow({ activity_id: "act-2", best_efforts: [{ name: "Half Marathon", elapsed_time: 4900 }] }),
    ];
    const best = computeStravaBests(rows);
    expect(best.size).toBe(1);
    expect(best.get(normalizeDistanceKey("Half-Marathon"))?.timeSeconds).toBe(4900);
  });
});

describe("buildPrRecords", () => {
  it("lets manual win by default when Strava has no data for that distance", () => {
    const records = buildPrRecords(new Map(), [makeManualEntry({ distanceLabel: "8K Turkey Trot" })]);
    expect(records).toHaveLength(1);
    expect(records[0].source).toBe("manual");
    expect(records[0].isStandardDistance).toBe(false);
  });

  it("picks the faster of Strava vs. manual for the same distance — Strava wins", () => {
    const stravaBests = computeStravaBests([
      makeDumpRow({ best_efforts: [{ name: "10K", elapsed_time: 2200 }] }),
    ]);
    const records = buildPrRecords(stravaBests, [makeManualEntry({ timeSeconds: 2400 })]);
    expect(records[0].source).toBe("strava");
    expect(records[0].timeSeconds).toBe(2200);
    // The beaten manual candidate is still embedded for comparison display.
    expect(records[0].manual?.timeSeconds).toBe(2400);
  });

  it("picks the faster of Strava vs. manual for the same distance — manual wins", () => {
    // The motivating case: a true 10K effort GPS-recorded short never gets a
    // Strava "10K" best_efforts entry at all from that run, but a *different*,
    // slower run did cross 10K and got tagged — the manual correction must win.
    const stravaBests = computeStravaBests([
      makeDumpRow({ best_efforts: [{ name: "10K", elapsed_time: 2500 }] }),
    ]);
    const records = buildPrRecords(
      stravaBests,
      [makeManualEntry({ timeSeconds: 2350, sourceActivityId: "act-gps-short" })],
    );
    expect(records[0].source).toBe("manual");
    expect(records[0].timeSeconds).toBe(2350);
    expect(records[0].strava?.timeSeconds).toBe(2500); // beaten Strava entry still visible
  });

  it("only keeps the fastest of multiple manual entries for the same distance", () => {
    const records = buildPrRecords(new Map(), [
      makeManualEntry({ id: "m-1", timeSeconds: 2400 }),
      makeManualEntry({ id: "m-2", timeSeconds: 2200 }),
    ]);
    expect(records).toHaveLength(1);
    expect(records[0].manual?.id).toBe("m-2");
  });

  it("sorts standard distances by the canonical ladder, then customs alphabetically", () => {
    const stravaBests = computeStravaBests([
      makeDumpRow({ best_efforts: [{ name: "Marathon", elapsed_time: 12000 }, { name: "5K", elapsed_time: 1100 }] }),
    ]);
    const records = buildPrRecords(stravaBests, [
      makeManualEntry({ distanceLabel: "Zebra Zone Zoomies", timeSeconds: 1 }),
      makeManualEntry({ id: "m-2", distanceLabel: "Alpha Run", timeSeconds: 1 }),
    ]);
    expect(records.map((r) => r.distanceLabel)).toEqual([
      "5K",
      "Marathon",
      "Alpha Run",
      "Zebra Zone Zoomies",
    ]);
  });

  it("uses canonical casing for a recognized distance regardless of input casing", () => {
    const stravaBests = computeStravaBests([makeDumpRow({ best_efforts: [{ name: "half-marathon", elapsed_time: 5000 }] })]);
    const records = buildPrRecords(stravaBests, []);
    expect(records[0].distanceLabel).toBe("Half-Marathon");
  });
});

describe("validateManualPrInput", () => {
  const valid = { distanceLabel: "10K", timeSeconds: 2400, achievedDate: "2026-01-01" };

  it("accepts a well-formed minimal body", () => {
    expect(validateManualPrInput(valid)).toEqual({ valid: true });
  });

  it("rejects a non-object body", () => {
    expect(validateManualPrInput(null).valid).toBe(false);
    expect(validateManualPrInput("nope").valid).toBe(false);
  });

  it("rejects an empty or overlong distanceLabel", () => {
    expect(validateManualPrInput({ ...valid, distanceLabel: "" }).valid).toBe(false);
    expect(validateManualPrInput({ ...valid, distanceLabel: "x".repeat(61) }).valid).toBe(false);
  });

  it("rejects a non-positive or non-integer timeSeconds", () => {
    expect(validateManualPrInput({ ...valid, timeSeconds: 0 }).valid).toBe(false);
    expect(validateManualPrInput({ ...valid, timeSeconds: -10 }).valid).toBe(false);
    expect(validateManualPrInput({ ...valid, timeSeconds: 12.5 }).valid).toBe(false);
  });

  it("rejects a timeSeconds above the 48h sanity ceiling", () => {
    expect(validateManualPrInput({ ...valid, timeSeconds: 172_801 }).valid).toBe(false);
    expect(validateManualPrInput({ ...valid, timeSeconds: 172_800 }).valid).toBe(true);
  });

  it("rejects a malformed or future achievedDate", () => {
    expect(validateManualPrInput({ ...valid, achievedDate: "01-01-2026" }).valid).toBe(false);
    expect(validateManualPrInput({ ...valid, achievedDate: "2026-13-40" }).valid).toBe(false);
    const future = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect(validateManualPrInput({ ...valid, achievedDate: future }).valid).toBe(false);
  });

  it("rejects overlong notes but allows omitted or short notes", () => {
    expect(validateManualPrInput({ ...valid }).valid).toBe(true);
    expect(validateManualPrInput({ ...valid, notes: "a short note" }).valid).toBe(true);
    expect(validateManualPrInput({ ...valid, notes: "x".repeat(201) }).valid).toBe(false);
  });

  it("rejects a non-string sourceActivityId but allows it omitted or null", () => {
    expect(validateManualPrInput({ ...valid, sourceActivityId: null }).valid).toBe(true);
    expect(validateManualPrInput({ ...valid, sourceActivityId: "act-1" }).valid).toBe(true);
    expect(validateManualPrInput({ ...valid, sourceActivityId: 123 }).valid).toBe(false);
  });
});
