import { StatCard } from "@/components/stat-card";
import { BandBadge } from "@/components/band-badge";
import { DailyLoadChart } from "@/components/daily-load-chart";
import { WeeklyVolumeChart, WeeklyPaceChart } from "@/components/weekly-trends-chart";
import { serverFetch } from "@/lib/api";
import type { TrainingLoadSummary, PerformanceTrends } from "@goalsplit/types";

const LOAD_FALLBACK: TrainingLoadSummary = {
  asOf: "",
  daily: [],
  acute: { days: 7, totalLoad: 0, avgLoad: 0, activityCount: 0, scoredCount: 0, coveragePct: null },
  chronic: { days: 28, totalLoad: 0, avgLoad: 0, activityCount: 0, scoredCount: 0, coveragePct: null },
  acwr: null,
  band: null,
  insufficientHistory: true,
  lowCoverage: false,
};

const TRENDS_FALLBACK: PerformanceTrends = { weeks: 12, volumeByType: [], runPace: [] };

export default async function TrainingPage() {
  const [load, trends] = await Promise.all([
    serverFetch<TrainingLoadSummary>("/training/load", LOAD_FALLBACK),
    serverFetch<PerformanceTrends>("/training/trends?weeks=12", TRENDS_FALLBACK),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Training</h1>
        <p className="mt-1 text-neutral-400">Training load and performance trends from your synced activities</p>
      </div>

      {load.insufficientHistory && (
        <div className="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm text-neutral-400">
          Need at least 28 days of synced activity history for a reliable training-load reading — keep syncing.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Current ACWR" value={load.acwr !== null ? load.acwr.toFixed(2) : "—"} />
        <StatCard label="7-Day Load" value={String(Math.round(load.acute.totalLoad))} />
        <StatCard label="28-Day Avg Load/Day" value={load.chronic.avgLoad.toFixed(1)} />
        <StatCard
          label="Data Coverage"
          value={load.acute.coveragePct !== null ? `${load.acute.coveragePct}%` : "—"}
          subtext={load.lowCoverage ? "Many activities lack effort data" : undefined}
        />
      </div>

      {load.band && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-neutral-400">Status:</span>
          <BandBadge band={load.band} />
        </div>
      )}

      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-4 text-base font-semibold">Daily Training Load (28 days)</h2>
        <DailyLoadChart daily={load.daily} chronicAvgLoad={load.chronic.avgLoad} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <h2 className="mb-4 text-base font-semibold">Weekly Volume</h2>
          <WeeklyVolumeChart volumeByType={trends.volumeByType} />
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <h2 className="mb-4 text-base font-semibold">Weekly Run Pace</h2>
          <WeeklyPaceChart runPace={trends.runPace} />
        </div>
      </div>
    </div>
  );
}
