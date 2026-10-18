import type { RacePredictionSummary } from "@goalsplit/types";
import { METHODS_URL } from "@/lib/constants";
import { formatDate, formatTime } from "@/lib/format";

const TH = "px-4 py-3 text-left text-xs font-medium text-neutral-500";
const TD = "px-4 py-3 tabular-nums";

function time(seconds: number): string {
  return formatTime(Math.round(seconds));
}

function signedPct(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

export function RacePredictions({ summary }: Readonly<{ summary: RacePredictionSummary }>) {
  const { level, predictions, typicalErrorPct, backtest } = summary;

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 overflow-hidden">
      <div className="flex items-baseline justify-between gap-4 px-5 pt-5">
        <h2 className="text-base font-semibold">Race predictions</h2>
        <a href={`${METHODS_URL}#race-predictions`} className="text-xs text-neutral-500 transition-colors hover:text-neutral-300">
          How this is calculated →
        </a>
      </div>

      {!level ? (
        <p className="p-10 text-center text-sm text-neutral-500">
          No road races yet — tag races as <em>Race</em> on Strava, then Sync.
        </p>
      ) : (
        <>
          <p className="px-5 pt-1 text-xs text-neutral-500">
            Current level VDOT {level.vdot.toFixed(1)}, the median of{" "}
            {level.stale ? "your most recent road race" : `your road races in the last ${Math.round(level.windowDays / 30)} months`}:{" "}
            {level.basedOn.map((r) => r.name).join(" · ")}.
            {typicalErrorPct !== null &&
              ` Typically within ±${typicalErrorPct.toFixed(0)}% (backtested on ${backtest.length} past races).`}
          </p>
          {level.stale && (
            <p className="mx-5 mt-3 rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-400">
              No road race in the last {Math.round(level.windowDays / 30)} months — these predictions reflect your fitness on{" "}
              {formatDate(level.basedOn[0].localDate)}, not today.
            </p>
          )}

          <table className="mt-4 w-full text-sm">
            <thead className="border-y border-neutral-800 bg-neutral-800/50">
              <tr>
                <th className={TH}>Distance</th>
                <th className={TH}>Predicted</th>
                <th className={TH} title="VDOT prediction corrected by how your own past races at this distance compared with it">
                  Adjusted for your record
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800/50">
              {predictions.map((p) => (
                <tr key={p.label}>
                  <td className="px-4 py-3 font-medium">{p.label}</td>
                  <td className={TD}>{time(p.timeS)}</td>
                  <td className={TD}>
                    {p.adjustedTimeS !== null && p.adjustmentPct !== null ? (
                      <>
                        {time(p.adjustedTimeS)}
                        <span className="ml-2 text-xs text-neutral-500">
                          {signedPct(p.adjustmentPct)} · {p.historyCount} race{p.historyCount === 1 ? "" : "s"}
                        </span>
                      </>
                    ) : (
                      <span className="text-xs text-neutral-500">No past races at this distance</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {backtest.length > 0 && (
            <details className="border-t border-neutral-800 px-5 py-4 text-sm">
              <summary className="cursor-pointer text-xs text-neutral-400 hover:text-neutral-200">
                How accurate has this been? Each past race, predicted from only the races before it
              </summary>
              <table className="mt-3 w-full">
                <thead>
                  <tr>
                    <th className={TH}>Date</th>
                    <th className={TH}>Race</th>
                    <th className={TH}>Actual</th>
                    <th className={TH}>Predicted</th>
                    <th className={TH}>Error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800/50">
                  {backtest.map((b) => (
                    <tr key={b.activityId} className="text-neutral-300">
                      <td className={`${TD} whitespace-nowrap text-neutral-500`}>{formatDate(b.localDate)}</td>
                      <td className="px-4 py-3">{b.name}</td>
                      <td className={TD}>{time(b.actualS)}</td>
                      <td className={TD}>{time(b.predictedS)}</td>
                      <td className={TD}>
                        {signedPct(b.errorPct)}
                        <span className="ml-1 text-xs text-neutral-500">{b.errorPct < 0 ? "too fast" : "too slow"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}

          <p className="border-t border-neutral-800 px-5 py-3 text-xs text-neutral-500">
            Road races only (tagged <em>Race</em> on Strava, not hilly, up to marathon length). Put the distance and official
            time in the title — e.g. &ldquo;Pisa 10k (44:25)&rdquo; — for the most accurate result.
          </p>
        </>
      )}
    </div>
  );
}
