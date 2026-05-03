import { SyncButton } from "./sync-button";
import { formatTime } from "@/lib/format";

interface ActivityRow {
  id: string;
  strava_id: number;
  name: string;
  type: string;
  sport_type: string;
  distance: number; // metres
  moving_time: number; // seconds
  total_elevation_gain: number; // metres
  average_speed: number; // m/s
  average_heartrate: number | null;
  start_date: string;
  start_date_local: string;
}

async function fetchActivities(): Promise<{ data: ActivityRow[]; total: number }> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";
  try {
    const res = await fetch(`${apiUrl}/activities?limit=10`, { next: { revalidate: 0 } });
    return res.json();
  } catch {
    return { data: [], total: 0 };
  }
}

const TYPE_ICON: Record<string, string> = {
  Run: "🏃",
  Ride: "🚴",
  Swim: "🏊",
  Walk: "🚶",
  Hike: "⛰️",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDistance(metres: number): string {
  return (metres / 1000).toFixed(2) + " km";
}

function formatPaceFromSpeed(speedMs: number): string {
  if (speedMs === 0) return "—";
  const secPerKm = Math.round(1000 / speedMs);
  return formatTime(secPerKm) + "/km";
}

export async function ActivityList() {
  const { data: activities, total } = await fetchActivities();

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
          <a href="/runs" className="text-xs text-brand-500 hover:text-brand-400 transition-colors">
            View all
          </a>
        </div>
      </div>

      {activities.length === 0 ? (
        <p className="text-sm text-neutral-500">
          No activities yet — connect Strava and hit Sync to import your runs.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-800/50">
          {activities.map((act) => (
            <li key={act.id} className="flex items-center justify-between gap-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="text-lg" aria-hidden>
                  {TYPE_ICON[act.type] ?? "🏃"}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{act.name}</p>
                  <p className="text-xs text-neutral-500">{formatDate(act.start_date_local)}</p>
                </div>
              </div>
              <div className="flex shrink-0 gap-4 text-right text-xs tabular-nums">
                <span>{formatDistance(act.distance)}</span>
                <span className="text-neutral-400">{formatTime(act.moving_time)}</span>
                <span className="hidden text-neutral-500 sm:block">
                  {formatPaceFromSpeed(act.average_speed)}
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
