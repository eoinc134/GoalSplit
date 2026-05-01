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

export async function PbsTable() {
  const pbs = await fetchPBs();

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">Personal Bests</h2>
        <a href="/pbs" className="text-xs text-brand-500 hover:text-brand-400 transition-colors">
          Edit
        </a>
      </div>

      {pbs.length === 0 ? (
        <p className="text-sm text-neutral-500">No PBs recorded yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-left text-xs text-neutral-500">
              <th className="pb-2 font-medium">Distance</th>
              <th className="pb-2 font-medium">PB</th>
              <th className="pb-2 font-medium">Pace</th>
              <th className="pb-2 font-medium text-brand-500/70">Target</th>
              <th className="pb-2 font-medium text-brand-500/70">Target Pace</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800/50">
            {pbs.map((pb) => (
              <tr key={pb.id}>
                <td className="py-2.5 font-medium">{pb.distanceLabel}</td>
                <td className="py-2.5 tabular-nums">{formatTime(pb.time)}</td>
                <td className="py-2.5 tabular-nums text-neutral-400">{formatPace(pb.pace)}</td>
                <td className="py-2.5 tabular-nums text-brand-400">
                  {pb.goalTime ? formatTime(pb.goalTime) : "—"}
                </td>
                <td className="py-2.5 tabular-nums text-brand-400/70">
                  {pb.goalPace ? formatPace(pb.goalPace) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
