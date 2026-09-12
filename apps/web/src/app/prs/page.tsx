import { PrManager } from "@/components/pr-manager";
import { serverFetch } from "@/lib/api";
import { formatTime, formatDate } from "@/lib/format";
import type { PersonalRecords } from "@goalsplit/types";
import type { ActivityRow } from "@/lib/types";

const PRS_FALLBACK: PersonalRecords = { records: [], manualEntries: [] };

export default async function PrsPage() {
  const [prs, activities] = await Promise.all([
    serverFetch<PersonalRecords>("/prs", PRS_FALLBACK),
    serverFetch<ActivityRow[]>("/activities?limit=200", []),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Personal Records</h1>
        <p className="mt-1 text-neutral-400">
          Best times per distance, computed fresh from Strava every time — plus your own
          corrections for what Strava&rsquo;s distance matching misses.
        </p>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900 overflow-hidden">
        {prs.records.length === 0 ? (
          <p className="p-10 text-center text-sm text-neutral-500">
            No records yet — sync some activities or add one manually below.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-800 bg-neutral-800/50">
              <tr className="text-left text-xs text-neutral-500">
                <th className="px-4 py-3 font-medium">Distance</th>
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800/50">
              {prs.records.map((record) => {
                const beaten = record.source === "strava" ? record.manual : record.strava;
                return (
                  <tr key={record.distanceLabel} className="hover:bg-neutral-800/30 transition-colors">
                    <td className="px-4 py-3 font-medium">{record.distanceLabel}</td>
                    <td className="px-4 py-3 tabular-nums">{formatTime(record.timeSeconds)}</td>
                    <td className="px-4 py-3 text-neutral-400">{formatDate(record.achievedDate)}</td>
                    <td className="px-4 py-3 text-neutral-400">
                      <span className={record.source === "strava" ? "text-orange-400" : "text-neutral-300"}>
                        {record.source === "strava" ? "Strava" : "Manual"}
                      </span>
                      {beaten && (
                        <span className="ml-2 text-xs text-neutral-600">
                          (beat {record.source === "strava" ? "manual" : "Strava"} {formatTime(beaten.timeSeconds)})
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <PrManager initialManualEntries={prs.manualEntries} activities={activities} />
    </div>
  );
}
