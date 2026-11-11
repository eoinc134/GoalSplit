import { describe, it, expect } from "vitest";
import type { SyncResult, SyncRunSummary } from "@goalsplit/types";
import { describeSyncResult, relativeTime, runDetail, runTone } from "./sync-messages";

const base: SyncResult = {
  synced: 5,
  inserted: 0,
  pages: 1,
  detailsFetched: 0,
  streamsFetched: 0,
  streamsMissing: 0,
  complete: true,
  stopReason: null,
  pendingEnrichment: 0,
};

describe("describeSyncResult", () => {
  it("says up to date when nothing changed", () => {
    expect(describeSyncResult(base)).toEqual({ text: "Already up to date", tone: "ok" });
  });

  it("counts new activities", () => {
    expect(describeSyncResult({ ...base, inserted: 2, detailsFetched: 2, streamsFetched: 2 }).text).toBe("+2 new activities");
  });

  it("mentions repaired activities separately", () => {
    expect(describeSyncResult({ ...base, streamsFetched: 3 }).text).toBe("No new activities, 3 filled in");
  });

  it("warns and explains when the rate limit cut the sync short", () => {
    const r = describeSyncResult({ ...base, inserted: 1, complete: false, stopReason: "rate_limit_15min" });
    expect(r.tone).toBe("warn");
    expect(r.text).toMatch(/15 minutes/);
    expect(describeSyncResult({ ...base, complete: false, stopReason: "rate_limit_daily" }).text).toMatch(/midnight UTC/);
  });

  it("points at Backfill History when old activities still lack streams", () => {
    const r = describeSyncResult({ ...base, pendingEnrichment: 12 });
    expect(r.tone).toBe("warn");
    expect(r.text).toMatch(/12 older activities/);
  });
});

describe("run summaries", () => {
  const run = (over: Partial<SyncRunSummary>): SyncRunSummary => ({
    id: "r",
    mode: "incremental",
    trigger: "manual",
    status: "ok",
    startedAt: "2026-11-11T10:00:00Z",
    finishedAt: "2026-11-11T10:01:00Z",
    items: 1,
    error: null,
    stopReason: null,
    ...over,
  });

  it("maps statuses to tones and surfaces the reason", () => {
    expect(runTone(run({}))).toBe("ok");
    expect(runTone(run({ status: "interrupted" }))).toBe("error");
    expect(runDetail(run({ status: "failed", error: "Garmin API 500" }))).toBe("Garmin API 500");
    expect(runDetail(run({ status: "partial", stopReason: "rate_limit_daily" }))).toMatch(/daily/);
    expect(runDetail(run({}))).toBeNull();
  });

  it("formats relative times", () => {
    const now = Date.parse("2026-11-11T12:00:00Z");
    expect(relativeTime("2026-11-11T11:59:50Z", now)).toBe("just now");
    expect(relativeTime("2026-11-11T11:15:00Z", now)).toBe("45 min ago");
    expect(relativeTime("2026-11-11T06:00:00Z", now)).toBe("6 h ago");
    expect(relativeTime("2026-11-08T12:00:00Z", now)).toBe("3 days ago");
  });
});
