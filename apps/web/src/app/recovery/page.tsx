import { StatCard } from "@/components/stat-card";
import { GarminSyncButton } from "@/components/garmin-sync-button";
import { RestingHrChart } from "@/components/resting-hr-chart";
import { SleepChart } from "@/components/sleep-chart";
import { serverFetch } from "@/lib/api";
import type { GarminDaysResponse } from "@goalsplit/types";

const FALLBACK: GarminDaysResponse = { days: [] };

export default async function RecoveryPage() {
  const { days } = await serverFetch<GarminDaysResponse>("/garmin/days?days=90", FALLBACK);
  const latest = days.length > 0 ? days[days.length - 1] : null;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Recovery</h1>
          <p className="mt-1 text-neutral-400">
            All-day wellness data from Garmin — resting HR, sleep, and readiness Strava can&rsquo;t see.
          </p>
        </div>
        <GarminSyncButton />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Resting HR" value={latest?.restingHeartRate ? `${latest.restingHeartRate} bpm` : "—"} />
        <StatCard label="HRV (last night)" value={latest?.hrvLastNightAvg ? `${Math.round(latest.hrvLastNightAvg)} ms` : "—"} />
        <StatCard
          label="Training Readiness"
          value={latest?.trainingReadinessScore !== null && latest?.trainingReadinessScore !== undefined ? String(latest.trainingReadinessScore) : "—"}
          subtext={latest?.trainingReadinessLevel ?? undefined}
        />
        <StatCard label="Sleep (last night)" value={latest?.sleepDurationHours ? `${latest.sleepDurationHours.toFixed(1)}h` : "—"} />
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-4 text-base font-semibold">Resting Heart Rate</h2>
        <RestingHrChart days={days} />
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-4 text-base font-semibold">Sleep Duration</h2>
        <SleepChart days={days} />
      </div>
    </div>
  );
}
