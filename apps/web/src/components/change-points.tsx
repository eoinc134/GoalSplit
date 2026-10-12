import type { ChangePointResult } from "@goalsplit/types";
import { formatDate } from "@/lib/format";

// Segments are keyed by week start; show the phase ending on that week's Sunday.
function weekEnd(weekStart: string): string {
  const d = new Date(`${weekStart}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

function signedPct(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

interface ChangeListProps {
  result: ChangePointResult;
  format: (v: number) => string;
  higherIsBetter: boolean;
}

// Detected level shifts in words. Direction is spelled out ("improved" /
// "declined") with an arrow, never carried by colour alone.
export function ChangeList({ result, format, higherIsBetter }: Readonly<ChangeListProps>) {
  if (result.segments.length === 0) return null;
  if (result.changes.length === 0) {
    return (
      <p className="text-xs text-neutral-500">
        No sustained shift detected — week-to-week variation is within noise.
      </p>
    );
  }

  return (
    <ul className="space-y-1 text-xs text-neutral-400">
      {result.changes.map((c) => {
        const improved = higherIsBetter ? c.after > c.before : c.after < c.before;
        return (
          <li key={c.date}>
            <span aria-hidden className="mr-1.5">{c.after > c.before ? "▲" : "▼"}</span>
            From week of {formatDate(c.date)}: {format(c.before)} → {format(c.after)} ({signedPct(c.changePct)},{" "}
            {improved ? "improved" : "declined"})
          </li>
        );
      })}
    </ul>
  );
}

const TH = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-neutral-500";
const TD = "px-3 py-2 tabular-nums";

// Training phases: stretches of weeks at a consistent load level.
export function PhasesTable({ result }: Readonly<{ result: ChangePointResult }>) {
  if (result.segments.length === 0) {
    return <p className="py-10 text-center text-sm text-neutral-500">Not enough weekly history to detect phases yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-neutral-800">
          <tr>
            <th className={TH}>Phase</th>
            <th className={TH}>Weeks</th>
            <th className={TH}>Avg weekly TRIMP</th>
            <th className={TH}>vs previous</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800/60">
          {result.segments.map((seg, i) => {
            const change = i > 0 ? result.changes[i - 1] : null;
            return (
              <tr key={seg.start} className="text-neutral-200">
                <td className={`${TD} whitespace-nowrap`}>
                  {formatDate(seg.start)} – {formatDate(weekEnd(seg.end))}
                </td>
                <td className={TD}>{seg.weeks}</td>
                <td className={TD}>{Math.round(seg.mean)}</td>
                <td className={TD}>{change ? signedPct(change.changePct) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
