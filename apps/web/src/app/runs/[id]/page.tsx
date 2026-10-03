import { notFound } from "next/navigation";
import Link from "next/link";
import { StatCard } from "@/components/stat-card";
import { RouteMap } from "@/components/route-map";
import { API_URL } from "@/lib/api";
import { formatTime, formatDate, paceFromSpeed } from "@/lib/format";
import type { ActivityDetail } from "@/lib/types";
import type { ActivityRoute } from "@goalsplit/types";

async function fetchActivity(id: string): Promise<ActivityDetail | null> {
  const res = await fetch(`${API_URL}/activities/${id}`, { next: { revalidate: 0 } });
  if (res.status === 404) return null;
  const { data } = (await res.json()) as { data: ActivityDetail };
  return data;
}

function formatDistance(metres: number) {
  return (metres / 1000).toFixed(2) + " km";
}

interface ActivityDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function ActivityDetailPage({ params }: Readonly<ActivityDetailPageProps>) {
  const { id } = await params;
  const activity = await fetchActivity(id);
  if (!activity) notFound();

  const route: ActivityRoute | null = activity.route
    ? {
        activityId: activity.id,
        activityName: activity.name,
        type: activity.type,
        localDate: activity.start_date_local.slice(0, 10),
        points: activity.route,
      }
    : null;

  return (
    <div className="space-y-6">
      <Link href="/runs" className="text-sm text-neutral-500 hover:text-neutral-300 transition-colors">
        ← Back to Activities
      </Link>

      <div>
        <h1 className="text-3xl font-bold tracking-tight">{activity.name}</h1>
        <p className="mt-1 text-neutral-400">
          {activity.sport_type} · {formatDate(activity.start_date_local, true)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Distance" value={formatDistance(activity.distance)} />
        <StatCard label="Moving Time" value={formatTime(activity.moving_time)} />
        <StatCard label="Pace" value={paceFromSpeed(activity.average_speed)} />
        <StatCard
          label="Elevation"
          value={activity.total_elevation_gain > 0 ? `${Math.round(activity.total_elevation_gain)}m` : "—"}
        />
      </div>

      {(activity.average_heartrate || activity.max_heartrate) && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard
            label="Avg HR"
            value={activity.average_heartrate ? `${Math.round(activity.average_heartrate)} bpm` : "—"}
          />
          <StatCard label="Max HR" value={activity.max_heartrate ? `${Math.round(activity.max_heartrate)} bpm` : "—"} />
        </div>
      )}

      {route && (
        <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 p-2">
          <RouteMap routes={[route]} />
        </div>
      )}

      {activity.notes && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <h2 className="mb-3 text-base font-semibold">Notes</h2>
          <pre className="whitespace-pre-wrap font-sans text-sm text-neutral-300">{activity.notes}</pre>
        </div>
      )}
    </div>
  );
}
