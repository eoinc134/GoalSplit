import type { PersonalBest, ApiResponse } from "@goalsplit/types";
import { formatTime, formatPace } from "@/lib/format";

async function fetchPBs(): Promise<PersonalBest[]> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";
  try {
    const res = await fetch(`${apiUrl}/pbs`, { next: { revalidate: 0 } });
    const json: ApiResponse<PersonalBest[]> = await res.json();
    return json.data;
  } catch {
    return [];
  }
}

function GapBadge({ current, goal }: { current: number; goal: number }) {
  const diffSec = current - goal;
  if (diffSec <= 0) return <span className="text-xs text-emerald-400">Goal reached!</span>;
  return (
    <span className="text-xs text-neutral-500">
      -{formatTime(diffSec)} to go
    </span>
  );
}

export default async function PbsPage() {
  const pbs = await fetchPBs();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Personal Bests</h1>
        <p className="mt-1 text-neutral-400">Current bests and target times</p>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-800 bg-neutral-800/50">
            <tr className="text-left text-xs text-neutral-500">
              <th className="px-5 py-3 font-medium">Distance</th>
              <th className="px-5 py-3 font-medium">Current PB</th>
              <th className="px-5 py-3 font-medium">Pace</th>
              <th className="px-5 py-3 font-medium text-brand-400">Target</th>
              <th className="px-5 py-3 font-medium text-brand-400">Target Pace</th>
              <th className="px-5 py-3 font-medium">Gap</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800/50">
            {pbs.map((pb) => (
              <tr key={pb.id} className="hover:bg-neutral-800/30 transition-colors">
                <td className="px-5 py-4 font-semibold">{pb.distanceLabel}</td>
                <td className="px-5 py-4 tabular-nums">{formatTime(pb.time)}</td>
                <td className="px-5 py-4 tabular-nums text-neutral-400">{formatPace(pb.pace)}</td>
                <td className="px-5 py-4 tabular-nums text-brand-400">
                  {pb.goalTime ? formatTime(pb.goalTime) : "—"}
                </td>
                <td className="px-5 py-4 tabular-nums text-brand-400/70">
                  {pb.goalPace ? formatPace(pb.goalPace) : "—"}
                </td>
                <td className="px-5 py-4">
                  {pb.goalTime ? (
                    <GapBadge current={pb.time} goal={pb.goalTime} />
                  ) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
