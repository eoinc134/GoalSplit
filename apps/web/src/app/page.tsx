import { StatCard } from "@/components/stat-card";
import { TeaserCard } from "@/components/teaser-card";
import { BandBadge } from "@/components/band-badge";
import { StravaConnect } from "@/components/strava-connect";
import { SyncStatusPanel } from "@/components/sync-status";
import { ActivityList } from "@/components/activity-list";
import { LoadErrorBanner } from "@/components/states";
import { failures, load } from "@/lib/server-api";
import { latestValue } from "@/lib/garmin";
import { GARMIN_FALLBACK, LOAD_FALLBACK, PRS_FALLBACK, STATS_FALLBACK } from "@/lib/fallbacks";
import { formatTime, formatDate } from "@/lib/format";
import type { DashboardStats, TrainingLoadSummary, GarminDaysResponse, PersonalRecords, PrRecord } from "@goalsplit/types";

const UNAVAILABLE = "Couldn't load";

function latestPr(records: PrRecord[]): PrRecord | null {
  if (records.length === 0) return null;
  return records.reduce((latest, r) => (r.achievedDate > latest.achievedDate ? r : latest), records[0]);
}

export default async function DashboardPage() {
  const [statsLoad, trainingLoad, garminLoad, prsLoad] = await Promise.all([
    load<DashboardStats>("/dashboard/stats", STATS_FALLBACK),
    load<TrainingLoadSummary>("/training/load?days=28", LOAD_FALLBACK),
    load<GarminDaysResponse>("/garmin/days?days=14", GARMIN_FALLBACK),
    load<PersonalRecords>("/prs", PRS_FALLBACK),
  ]);
  const stats = statsLoad.data;
  const training = trainingLoad.data;
  const restingHr = latestValue(garminLoad.data.days, "restingHeartRate");
  const topPr = latestPr(prsLoad.data.records);
  // A failed read shows "—" and says so, never a misleading 0.
  const stat = (value: string) => (statsLoad.error ? "—" : value);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-neutral-400">Your training overview</p>
      </div>

      <LoadErrorBanner errors={failures(statsLoad, trainingLoad, garminLoad, prsLoad)} />

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard label="Total Runs" value={stat(String(stats.totalRuns))} subtext={statsLoad.error ? UNAVAILABLE : undefined} />
        <StatCard label="Total Distance" value={stat(`${stats.totalDistance} km`)} />
        <StatCard label="This Week" value={stat(`${stats.weeklyDistance} km`)} />
      </div>

      {/* Analytics teasers — headline from Training, Recovery, and Records */}
      <div>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-neutral-500">Analytics</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <TeaserCard
            href="/training"
            label="Fitness (CTL)"
            value={training.asOf ? training.current.ctl.toFixed(0) : "—"}
            subtext={
              trainingLoad.error
                ? UNAVAILABLE
                : training.current.band
                  ? <BandBadge band={training.current.band} />
                  : "Keep syncing for a reading"
            }
          />
          <TeaserCard
            href="/recovery"
            label="Resting HR"
            value={restingHr ? `${restingHr.value} bpm` : "—"}
            subtext={garminLoad.error ? UNAVAILABLE : restingHr ? `via Garmin · ${formatDate(restingHr.day)}` : "Sync Garmin to unlock"}
          />
          <TeaserCard
            href="/prs"
            label="Latest PR"
            value={topPr ? `${topPr.distanceLabel} · ${formatTime(topPr.timeSeconds)}` : "—"}
            subtext={prsLoad.error ? UNAVAILABLE : topPr ? formatDate(topPr.achievedDate) : "No records yet"}
          />
        </div>
      </div>

      {/* Strava section */}
      <div className="space-y-4">
        <StravaConnect />
        <SyncStatusPanel />
        <ActivityList />
      </div>
    </div>
  );
}
