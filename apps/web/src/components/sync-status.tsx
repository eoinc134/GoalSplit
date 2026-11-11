import type { SyncRunSummary, SyncStatusResponse } from "@goalsplit/types";
import { serverFetch } from "@/lib/server-api";
import { relativeTime, runDetail, runStatusLabel, runTone } from "@/lib/sync-messages";

// Pipeline health at a glance: the latest Strava and Garmin sync, whether it
// worked, and — when it didn't — why. Data from GET /api/sync/status.

const TONE_CLASS = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  error: "bg-red-500",
  neutral: "bg-neutral-500",
} as const;

function SourceRow({
  label,
  last,
  lastSuccess,
  running,
  note,
}: Readonly<{
  label: string;
  last: SyncRunSummary | null;
  lastSuccess: SyncRunSummary | null;
  running: boolean;
  note?: string | null;
}>) {
  if (!last) {
    return (
      <div className="flex items-start gap-3">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE_CLASS.neutral}`} />
        <p className="text-sm text-neutral-400">
          <span className="font-medium text-neutral-200">{label}</span> — never synced
        </p>
      </div>
    );
  }

  const tone = running ? "neutral" : runTone(last);
  const detail = running ? null : runDetail(last);
  const showLastSuccess = lastSuccess && lastSuccess.id !== last.id;

  return (
    <div className="flex items-start gap-3">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE_CLASS[tone]}`} />
      <div className="min-w-0 text-sm">
        <p className="text-neutral-400">
          <span className="font-medium text-neutral-200">{label}</span>{" "}
          {running ? "syncing now…" : `${runStatusLabel(last)} · ${relativeTime(last.finishedAt ?? last.startedAt)}`}
          {!running && last.trigger === "scheduled" && " (scheduled)"}
        </p>
        {detail && <p className="mt-0.5 text-xs text-neutral-500">{detail}</p>}
        {showLastSuccess && (
          <p className="mt-0.5 text-xs text-neutral-500">
            Last successful sync {relativeTime(lastSuccess.finishedAt ?? lastSuccess.startedAt)}
          </p>
        )}
        {note && <p className="mt-0.5 text-xs text-neutral-500">{note}</p>}
      </div>
    </div>
  );
}

export async function SyncStatusPanel() {
  const status = await serverFetch<SyncStatusResponse | null>("/sync/status", null);
  if (!status) return null;

  const pending = status.strava.pendingEnrichment;
  const nextRun = status.schedule.nextRunAt;

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-neutral-500">Data sync</h2>
      <div className="space-y-3">
        <SourceRow
          label="Strava"
          {...status.strava}
          note={pending > 0 ? `${pending} activities still need detail/streams — filled in over the next syncs, or use Backfill History` : null}
        />
        {status.garmin.configured && <SourceRow label="Garmin" {...status.garmin} />}
      </div>
      <p className="mt-4 text-xs text-neutral-600">
        {status.schedule.intervalMinutes > 0
          ? `Syncs automatically every ${status.schedule.intervalMinutes >= 60 ? `${Math.round(status.schedule.intervalMinutes / 60)} h` : `${status.schedule.intervalMinutes} min`}${nextRun ? ` · next ${new Date(nextRun).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}`
          : "Automatic sync is off"}
      </p>
    </div>
  );
}
