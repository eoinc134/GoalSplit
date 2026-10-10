import Link from "next/link";
import type { DurabilityBin, LongRunResult } from "@goalsplit/types";
import { formatDate, formatPace, formatTime } from "@/lib/format";

function pct(v: number | null, digits = 1): string {
  return v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

const TH = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-neutral-500";
const TD = "px-3 py-2 tabular-nums";

export function LongRunsTable({ runs }: Readonly<{ runs: LongRunResult[] }>) {
  if (runs.length === 0) {
    return <p className="py-10 text-center text-sm text-neutral-500">No long runs in this window yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-neutral-800">
          <tr>
            <th className={TH}>Date</th>
            <th className={TH}>Run</th>
            <th className={TH}>Distance</th>
            <th className={TH}>Time</th>
            <th className={TH}>GAP pace</th>
            <th className={TH}>Avg HR</th>
            <th className={TH} title="Pa:HR decoupling, first vs second half">Drift</th>
            <th className={TH} title="Last-quarter GAP pace vs first quarter">Fade</th>
            <th className={TH} title="Last-quarter avg HR minus first quarter">HR rise</th>
            <th className={TH} title="Share of that week's run distance">Week %</th>
            <th className={TH} title="Device-recorded">Temp</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800/60">
          {runs.map((r) => (
            <tr key={r.activityId} className="text-neutral-200">
              <td className={`${TD} whitespace-nowrap text-neutral-400`}>{formatDate(r.localDate)}</td>
              <td className="px-3 py-2">
                <Link href={`/runs/${r.activityId}`} className="hover:text-brand-500">
                  {r.activityName}
                </Link>
                {r.hilly && <span className="ml-2 text-xs text-neutral-500">hilly</span>}
              </td>
              <td className={TD}>{(r.distanceM / 1000).toFixed(1)} km</td>
              <td className={TD}>{formatTime(r.movingTimeS)}</td>
              <td className={TD}>{r.gapPaceSecPerKm !== null ? formatPace(r.gapPaceSecPerKm) : "—"}</td>
              <td className={TD}>{r.avgHr !== null ? Math.round(r.avgHr) : "—"}</td>
              <td className={TD}>{pct(r.decouplingPct)}</td>
              <td className={TD}>{pct(r.paceFadePct)}</td>
              <td className={TD}>{r.hrRiseBpm !== null ? `${r.hrRiseBpm > 0 ? "+" : ""}${r.hrRiseBpm.toFixed(0)}` : "—"}</td>
              <td className={TD}>{r.weekSharePct !== null ? `${Math.round(r.weekSharePct)}%` : "—"}</td>
              <td className={TD}>{r.avgTempC !== null ? `${Math.round(r.avgTempC)}°` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Durability: how drift and fade grow with duration. Rising medians across
// bins show where aerobic durability currently runs out.
export function DurabilityTable({ bins }: Readonly<{ bins: DurabilityBin[] }>) {
  return (
    <table className="w-full text-sm">
      <thead className="border-b border-neutral-800">
        <tr>
          <th className={TH}>Duration</th>
          <th className={TH}>Runs</th>
          <th className={TH}>Median drift</th>
          <th className={TH}>Median fade</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-neutral-800/60">
        {bins.map((b) => (
          <tr key={b.label} className="text-neutral-200">
            <td className={TD}>{b.label}</td>
            <td className={TD}>{b.runCount}</td>
            <td className={TD}>{pct(b.medianDecouplingPct)}</td>
            <td className={TD}>{pct(b.medianPaceFadePct)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
