import { StatCard } from "@/components/stat-card";
import { TeaserCard } from "@/components/teaser-card";
import { BandBadge } from "@/components/band-badge";
import { StravaConnect } from "@/components/strava-connect";
import { ActivityList } from "@/components/activity-list";
import { serverFetch } from "@/lib/api";
import { formatTime, formatDate } from "@/lib/format";
import type { TrainingLoadSummary, GarminDaysResponse, PersonalRecords, PrRecord } from "@goalsplit/types";

interface Stats {
  totalRuns: number;
  totalDistance: number;
  weeklyDistance: number;
}

const STATS_FALLBACK: Stats = { totalRuns: 0, totalDistance: 0, weeklyDistance: 0 };

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

const GARMIN_FALLBACK: GarminDaysResponse = { days: [] };
const PRS_FALLBACK: PersonalRecords = { records: [], manualEntries: [] };

function latestPr(records: PrRecord[]): PrRecord | null {
  if (records.length === 0) return null;
  return records.reduce((latest, r) => (r.achievedDate > latest.achievedDate ? r : latest), records[0]);
}

interface DashboardPageProps {
  searchParams: Promise<{ strava?: string }>;
}

export default async function DashboardPage({ searchParams }: Readonly<DashboardPageProps>) {
  const [{ strava }, stats, load, garmin, prs] = await Promise.all([
    searchParams,
    serverFetch<Stats>("/dashboard/stats", STATS_FALLBACK),
    serverFetch<TrainingLoadSummary>("/training/load", LOAD_FALLBACK),
    serverFetch<GarminDaysResponse>("/garmin/days?days=7", GARMIN_FALLBACK),
    serverFetch<PersonalRecords>("/prs", PRS_FALLBACK),
  ]);

  const latestRestingHr = garmin.days.length > 0 ? garmin.days[garmin.days.length - 1].restingHeartRate : null;
  const topPr = latestPr(prs.records);

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
        <p className="mt-1 text-neutral-400">Your training overview</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard label="Total Runs" value={String(stats.totalRuns)} />
        <StatCard label="Total Distance" value={`${stats.totalDistance} km`} />
        <StatCard label="This Week" value={`${stats.weeklyDistance} km`} />
      </div>

      {/* Analytics teasers — headline from Training, Recovery, and Records */}
      <div>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-neutral-500">Analytics</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <TeaserCard
            href="/training"
            label="Training Load"
            value={load.acwr !== null ? load.acwr.toFixed(2) : "—"}
            subtext={load.band ? <BandBadge band={load.band} /> : "Keep syncing for a reading"}
          />
          <TeaserCard
            href="/recovery"
            label="Resting HR"
            value={latestRestingHr !== null ? `${latestRestingHr} bpm` : "—"}
            subtext={latestRestingHr !== null ? "via Garmin" : "Sync Garmin to unlock"}
          />
          <TeaserCard
            href="/prs"
            label="Latest PR"
            value={topPr ? `${topPr.distanceLabel} · ${formatTime(topPr.timeSeconds)}` : "—"}
            subtext={topPr ? formatDate(topPr.achievedDate) : "No records yet"}
          />
        </div>
      </div>

      {/* Strava section */}
      <div className="space-y-4">
        <StravaConnect />
        <ActivityList />
      </div>
    </div>
  );
}
