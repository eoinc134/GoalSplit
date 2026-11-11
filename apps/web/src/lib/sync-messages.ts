import type { SyncResult, SyncRunSummary } from "@goalsplit/types";

// Human wording for sync outcomes, shared by the Sync buttons and the
// dashboard's sync status panel.

export function describeStopReason(reason: string | null | undefined): string | null {
  if (reason === "rate_limit_15min") return "Strava's 15-minute rate limit was reached — sync again in 15 minutes to continue";
  if (reason === "rate_limit_daily") return "Strava's daily rate limit was reached — it continues after midnight UTC";
  return null;
}

export function describeSyncResult(result: SyncResult): { text: string; tone: "ok" | "warn" } {
  const parts: string[] = [];
  parts.push(result.inserted > 0 ? `+${result.inserted} new activities` : "No new activities");
  const enriched = Math.max(result.detailsFetched, result.streamsFetched);
  if (enriched > 0 && enriched !== result.inserted) parts.push(`${enriched} filled in`);

  const stop = describeStopReason(result.stopReason);
  if (stop) return { text: `${parts.join(", ")}. ${stop}.`, tone: "warn" };

  if (result.pendingEnrichment > 0) {
    parts.push(`${result.pendingEnrichment} older activities still need detail/streams (Backfill History)`);
    return { text: parts.join(", "), tone: "warn" };
  }
  return { text: result.inserted === 0 && enriched === 0 ? "Already up to date" : parts.join(", "), tone: "ok" };
}

const STATUS_LABEL: Record<SyncRunSummary["status"], string> = {
  running: "Running",
  ok: "OK",
  partial: "Partial",
  failed: "Failed",
  interrupted: "Interrupted",
};

export function runStatusLabel(run: SyncRunSummary): string {
  return STATUS_LABEL[run.status];
}

export function runTone(run: SyncRunSummary): "ok" | "warn" | "error" | "neutral" {
  if (run.status === "ok") return "ok";
  if (run.status === "partial") return "warn";
  if (run.status === "failed" || run.status === "interrupted") return "error";
  return "neutral";
}

export function runDetail(run: SyncRunSummary): string | null {
  if (run.status === "partial") return describeStopReason(run.stopReason);
  if (run.status === "failed" || run.status === "interrupted") return run.error;
  return null;
}

// "5 min ago", "3 h ago", "2 days ago" — `now` is injectable for tests.
export function relativeTime(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}
