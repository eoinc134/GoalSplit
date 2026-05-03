import { SyncButton } from "@/components/sync-button";
import { formatTime, formatDate, paceFromSpeed } from "@/lib/format";
import { API_URL } from "@/lib/api";
import { ACTIVITY_TYPE_ICON, ACTIVITY_FILTERS } from "@/lib/constants";
import type { ActivityRow } from "@/lib/types";

const PAGE_SIZE = 30;

async function fetchActivities(type: string, page: number) {
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(page * PAGE_SIZE),
    ...(type ? { type } : {}),
  });
  try {
    const res = await fetch(`${API_URL}/activities?${params}`, { next: { revalidate: 0 } });
    return res.json() as Promise<{ data: ActivityRow[]; total: number }>;
  } catch {
    return { data: [], total: 0 };
  }
}

function formatDistance(metres: number) {
  return (metres / 1000).toFixed(2) + " km";
}

interface RunsPageProps {
  searchParams: Promise<{ type?: string; page?: string }>;
}

export default async function RunsPage({ searchParams }: RunsPageProps) {
  const { type = "Run", page: pageStr = "0" } = await searchParams;
  const page = Math.max(0, parseInt(pageStr));

  const { data: activities, total } = await fetchActivities(type, page);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const hasPrev = page > 0;
  const hasNext = page < totalPages - 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Activities</h1>
          <p className="mt-1 text-neutral-400">
            {total > 0 ? `${total} activities synced from Strava` : "No activities synced yet"}
          </p>
        </div>
        <SyncButton />
      </div>

      {/* Type filter tabs */}
      <div className="flex gap-1 rounded-lg border border-neutral-800 bg-neutral-900 p-1 w-fit">
        {ACTIVITY_FILTERS.map((f) => {
          const isActive = f.value === type || (!f.value && !type);
          return (
            <a
              key={f.value}
              href={`/runs?type=${f.value}&page=0`}
              className={[
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-neutral-700 text-neutral-50"
                  : "text-neutral-400 hover:text-neutral-200",
              ].join(" ")}
            >
              {f.label}
            </a>
          );
        })}
      </div>

      {/* Table */}
      {activities.length === 0 ? (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-10 text-center">
          <p className="text-sm text-neutral-500">
            {total === 0
              ? "No activities yet — connect Strava and hit Sync."
              : `No ${type.toLowerCase()} activities found.`}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-800 bg-neutral-800/50">
              <tr className="text-left text-xs text-neutral-500">
                <th className="px-4 py-3 font-medium">Activity</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Distance</th>
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Pace</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">Elevation</th>
                <th className="px-4 py-3 font-medium hidden lg:table-cell">Avg HR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800/50">
              {activities.map((act) => (
                <tr key={act.id} className="hover:bg-neutral-800/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span aria-hidden>{ACTIVITY_TYPE_ICON[act.type] ?? "🏃"}</span>
                      <div>
                        <p className="font-medium truncate max-w-[180px]">{act.name}</p>
                        <p className="text-xs text-neutral-500">{act.sport_type}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-neutral-400 whitespace-nowrap">
                    {formatDate(act.start_date_local, true)}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{formatDistance(act.distance)}</td>
                  <td className="px-4 py-3 tabular-nums text-neutral-400">
                    {formatTime(act.moving_time)}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-neutral-400">
                    {paceFromSpeed(act.average_speed)}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-neutral-400 hidden md:table-cell">
                    {act.total_elevation_gain > 0
                      ? `${Math.round(act.total_elevation_gain)}m`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-neutral-400 hidden lg:table-cell">
                    {act.average_heartrate ? `${Math.round(act.average_heartrate)} bpm` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-neutral-500">
            Page {page + 1} of {totalPages}
          </span>
          <div className="flex gap-2">
            <a
              href={hasPrev ? `/runs?type=${type}&page=${page - 1}` : "#"}
              aria-disabled={!hasPrev}
              className={[
                "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                hasPrev
                  ? "border-neutral-700 text-neutral-300 hover:border-neutral-500"
                  : "border-neutral-800 text-neutral-600 pointer-events-none",
              ].join(" ")}
            >
              Previous
            </a>
            <a
              href={hasNext ? `/runs?type=${type}&page=${page + 1}` : "#"}
              aria-disabled={!hasNext}
              className={[
                "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                hasNext
                  ? "border-neutral-700 text-neutral-300 hover:border-neutral-500"
                  : "border-neutral-800 text-neutral-600 pointer-events-none",
              ].join(" ")}
            >
              Next
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
