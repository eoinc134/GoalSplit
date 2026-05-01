import { StatCard } from "@/components/stat-card";
import { GoalsList } from "@/components/goals-list";
import { PbsTable } from "@/components/pbs-table";
import { RecentRuns } from "@/components/recent-runs";

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-neutral-400">Your running overview</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total Runs" value="0" />
        <StatCard label="Total Distance" value="0 km" />
        <StatCard label="This Week" value="0 km" />
        <StatCard label="Active Goals" value="0" />
      </div>

      {/* Main content grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        <GoalsList />
        <PbsTable />
      </div>

      <RecentRuns />
    </div>
  );
}
