import Link from "next/link";
import { SyncButton } from "./sync-button";
import { formatTime, formatDate, paceFromSpeed } from "@/lib/format";
import { loadList } from "@/lib/server-api";
import { ACTIVITY_TYPE_ICON } from "@/lib/constants";
import { EmptyState, ErrorState } from "./states";
import type { ActivityRow } from "@goalsplit/types";

function formatDistance(metres: number): string {
  return (metres / 1000).toFixed(2) + " km";
}

export async function ActivityList() {
  const { data, error } = await loadList<ActivityRow>("/activities?limit=10");
  const { rows: activities, total } = data;

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Recent Activities</h2>
          {total > 0 && (
            <p className="text-xs text-neutral-500">{total} total synced</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <SyncButton />
          <Link href="/runs" className="text-xs text-brand-500 hover:text-brand-400 transition-colors">
            View all
          </Link>
        </div>
      </div>

      {error ? (
        <ErrorState error={error} size="sm" />
      ) : activities.length === 0 ? (
        <EmptyState size="sm" message="No activities yet." hint="Connect Strava and hit Sync to import your runs." />
      ) : (
        <ul className="divide-y divide-neutral-800/50">
          {activities.map((act) => (
            <li key={act.id} className="flex items-center justify-between gap-4 py-3">
              <Link href={`/runs/${act.id}`} className="flex min-w-0 items-center gap-3 group">
                <span className="text-lg" aria-hidden>
                  {ACTIVITY_TYPE_ICON[act.type] ?? "🏃"}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium group-hover:text-brand-400 transition-colors">
                    {act.name}
                  </p>
                  <p className="text-xs text-neutral-500">{formatDate(act.start_date_local)}</p>
                </div>
              </Link>
              <div className="flex shrink-0 gap-4 text-right text-xs tabular-nums">
                <span>{formatDistance(act.distance)}</span>
                <span className="text-neutral-400">{formatTime(act.moving_time)}</span>
                <span className="hidden text-neutral-500 sm:block">
                  {paceFromSpeed(act.average_speed)}
                </span>
                {act.average_heartrate && (
                  <span className="hidden text-neutral-500 sm:block">
                    {Math.round(act.average_heartrate)} bpm
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
