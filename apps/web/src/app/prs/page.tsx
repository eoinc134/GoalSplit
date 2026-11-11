import { PrManager } from "@/components/pr-manager";
import { RacePredictions } from "@/components/race-predictions";
import { EmptyState, ErrorState, LoadErrorBanner } from "@/components/states";
import { PREDICTIONS_FALLBACK, PRS_FALLBACK } from "@/lib/fallbacks";
import { failures, load, loadList } from "@/lib/server-api";
import { formatTime, formatDate } from "@/lib/format";
import type { ActivityRow, PersonalRecords, RacePredictionSummary } from "@goalsplit/types";

export default async function PrsPage() {
  const [prsR, activitiesR, predictionsR] = await Promise.all([
    load<PersonalRecords>("/prs", PRS_FALLBACK),
    loadList<ActivityRow>("/activities?limit=200"),
    load<RacePredictionSummary>("/prs/predictions", PREDICTIONS_FALLBACK),
  ]);
  const prs = prsR.data;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Personal Records</h1>
        <p className="mt-1 text-neutral-400">
          Best times per distance, computed fresh from Strava every time — plus your own
          corrections for what Strava&rsquo;s distance matching misses.
        </p>
      </div>

      <LoadErrorBanner errors={failures(prsR, activitiesR, predictionsR)} />

      <div className="rounded-xl border border-neutral-800 bg-neutral-900 overflow-hidden">
        {prsR.error ? (
          <ErrorState error={prsR.error} />
        ) : prs.records.length === 0 ? (
          <EmptyState message="No records yet." hint="Sync some activities, or add one manually below." />
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

      {predictionsR.error ? (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900">
          <ErrorState error={predictionsR.error} />
        </div>
      ) : (
        <RacePredictions summary={predictionsR.data} />
      )}

      {/* Without the existing entries the list would look empty, and an add
          could duplicate one — so the manager waits for a successful load. */}
      {prsR.error ? null : <PrManager initialManualEntries={prs.manualEntries} activities={activitiesR.data.rows} />}
    </div>
  );
}
