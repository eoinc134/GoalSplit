import { StatCard } from "@/components/stat-card";
import { GoalsList } from "@/components/goals-list";
import { PbsTable } from "@/components/pbs-table";
import { StravaConnect } from "@/components/strava-connect";
import { ActivityList } from "@/components/activity-list";
import { serverFetch } from "@/lib/api";

interface Stats {
  totalRuns: number;
  totalDistance: number;
  weeklyDistance: number;
  activeGoals: number;
  prioritizedGoals: number;
}

const STATS_FALLBACK: Stats = { totalRuns: 0, totalDistance: 0, weeklyDistance: 0, activeGoals: 0, prioritizedGoals: 0 };

interface DashboardPageProps {
  searchParams: Promise<{ strava?: string }>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const [{ strava }, stats] = await Promise.all([searchParams, serverFetch<Stats>("/dashboard/stats", STATS_FALLBACK)]);

  return (
    <div className="space-y-8">
      {/* OAuth result banner */}
      {strava === "connected" && (
        <div className="rounded-lg border border-emerald-700 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-300">
          Strava connected successfully! Hit <strong>Sync Activities</strong> to import your runs.
        </div>
      )}
      {strava === "error" && (
        <div className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-300">
          Could not connect to Strava — please try again.
        </div>
      )}

      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-neutral-400">Your running overview</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total Runs" value={String(stats.totalRuns)} />
        <StatCard label="Total Distance" value={`${stats.totalDistance} km`} />
        <StatCard label="This Week" value={`${stats.weeklyDistance} km`} />
        <StatCard
          label="Active Goals"
          value={String(stats.activeGoals)}
          subtext={stats.prioritizedGoals > 0 ? `${stats.prioritizedGoals} in focus` : undefined}
        />
      </div>

      {/* Goals + PBs */}
      <div className="grid gap-6 lg:grid-cols-2">
        <GoalsList />
        <PbsTable />
      </div>

      {/* Strava section */}
      <div className="space-y-4">
        <StravaConnect />
        <ActivityList />
      </div>
    </div>
  );
}
