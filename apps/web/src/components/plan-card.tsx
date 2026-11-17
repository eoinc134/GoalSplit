import type { PlanAdherence, PlanCriterionStatus, PlanWeek } from "@goalsplit/types";
import { EmptyState } from "./states";
import { formatDate } from "@/lib/format";

// Progress against the training-plan study's pre-registered criteria
// (research Proposal 3). The study's verdict comes from the Python follow-up;
// this card only tracks progress toward it.

const STATUS_META: Record<PlanCriterionStatus, { label: string; className: string }> = {
  met: { label: "Met", className: "text-emerald-400 border-emerald-700 bg-emerald-900/20" },
  "on-track": { label: "On track", className: "text-sky-300 border-sky-800 bg-sky-900/20" },
  "at-risk": { label: "At risk", className: "text-amber-400 border-amber-700 bg-amber-900/20" },
  missed: { label: "Missed", className: "text-red-400 border-red-800 bg-red-900/20" },
  pending: { label: "Pending", className: "text-neutral-400 border-neutral-700 bg-neutral-800/50" },
};

function StatusChip({ status }: Readonly<{ status: PlanCriterionStatus }>) {
  const meta = STATUS_META[status];
  return (
    <span className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${meta.className}`}>{meta.label}</span>
  );
}

function headline(p: PlanAdherence): string {
  if (p.status === "not-started") return `Starts ${formatDate(p.study.start)}`;
  if (p.status === "finished") return `Finished · ${p.metOrOnTrack} of 7 met`;
  return `Week ${p.weekNumber} of ${p.study.weeks} · ${p.metOrOnTrack} of 7 met or on track`;
}

function mark(on: boolean, week: PlanWeek): string {
  if (week.state === "future") return "";
  return on ? "✓" : "·";
}

const KIND_LABEL: Record<NonNullable<PlanWeek["kind"]>, string> = { deload: "deload", collapse: "drop", normal: "" };

function verdict(p: PlanAdherence): string {
  if (!p.onTrack) return "Can no longer be followed";
  return p.status === "finished" ? "Plan followed" : "Still achievable";
}

function WeekGrid({ weeks }: Readonly<{ weeks: PlanWeek[] }>) {
  const rows: { label: string; cell: (w: PlanWeek) => string; title?: string }[] = [
    { label: "km", cell: (w) => (w.state === "future" ? "" : w.km.toFixed(0)) },
    { label: "Week", cell: (w) => (w.kind ? KIND_LABEL[w.kind] : ""), title: "vs the previous 3 weeks' km" },
    { label: "Long", cell: (w) => mark(w.weekendLongRun, w), title: "Weekend 75+ min run" },
    { label: "Quality", cell: (w) => mark(w.quality, w) },
    { label: "Low %", cell: (w) => (w.lowPct === null || w.state === "future" ? "" : String(w.lowPct)) },
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-center text-xs tabular-nums">
        <thead>
          <tr className="text-neutral-500">
            <th className="py-1 pr-2 text-left font-medium">Wk</th>
            {weeks.map((w) => (
              <th
                key={w.weekStart}
                title={formatDate(w.weekStart)}
                className={`py-1 font-medium ${w.state === "current" ? "text-sky-300" : ""}`}
              >
                {w.weekNumber}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-neutral-300">
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-neutral-800/70">
              <th title={r.title} className="py-1.5 pr-2 text-left font-medium text-neutral-500">
                {r.label}
              </th>
              {weeks.map((w) => (
                <td key={w.weekStart} className={`py-1.5 ${w.state === "current" ? "bg-neutral-800/40" : ""}`}>
                  {r.cell(w)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PlanCard({ adherence }: Readonly<{ adherence: PlanAdherence | null }>) {
  if (!adherence) return <EmptyState message="Connect Strava to track the plan." size="sm" />;
  const p = adherence;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-neutral-200">{headline(p)}</p>
          <p className="text-xs text-neutral-500">
            {formatDate(p.study.start)} – {formatDate(p.study.end)} · followed = {p.requiredMin} of 7, with no 14+ day break
          </p>
        </div>
        {p.status !== "not-started" && (
          <span className={`text-xs font-medium ${p.onTrack ? "text-emerald-400" : "text-red-400"}`}>
            {verdict(p)}
          </span>
        )}
      </div>

      <ul className="divide-y divide-neutral-800/70">
        {p.criteria.map((c) => (
          <li key={c.key} className="flex items-start justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="text-sm text-neutral-200">{c.label}</p>
              <p className="text-xs text-neutral-500">{c.detail}</p>
            </div>
            <StatusChip status={c.status} />
          </li>
        ))}
      </ul>

      <WeekGrid weeks={p.weeks} />

      <a href={p.study.proposalUrl} className="inline-block text-xs text-neutral-500 transition-colors hover:text-neutral-300">
        Study design (Proposal 3) →
      </a>
    </div>
  );
}
