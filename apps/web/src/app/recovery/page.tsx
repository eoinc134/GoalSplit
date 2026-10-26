import { StatCard } from "@/components/stat-card";
import { RestingHrChart } from "@/components/resting-hr-chart";
import { SleepChart } from "@/components/sleep-chart";
import { GarminSyncButton } from "@/components/garmin-sync-button";
import { serverFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { GARMIN_FALLBACK, latestValue } from "@/lib/garmin";
import type { GarminDaysResponse } from "@goalsplit/types";

const STALE_AFTER_DAYS = 2;

function daysSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

function shortDate(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" });
}

// Tells the two ways data goes stale apart: our sync not running, versus the
// watch not having uploaded to Garmin Connect (Garmin itself has nothing newer).
function freshnessNote(latestDay: string | null, lastSyncedAt: string | null): { text: string; warn: boolean } {
  if (!lastSyncedAt || !latestDay) return { text: "No Garmin data yet. Press Sync Garmin.", warn: true };
  const base = `Garmin data through ${formatDate(latestDay)} · last synced ${formatDate(lastSyncedAt)}.`;
  if (daysSince(lastSyncedAt) > STALE_AFTER_DAYS) {
    return { text: `${base} Sync hasn't run recently. Press Sync Garmin to see why.`, warn: true };
  }
  if (daysSince(`${latestDay}T23:59:59Z`) > STALE_AFTER_DAYS) {
    return { text: `${base} Garmin has nothing newer. Open the Garmin Connect app so your watch uploads.`, warn: true };
  }
  return { text: base, warn: false };
}

export default async function RecoveryPage() {
  const { days, latestDay, lastSyncedAt } = await serverFetch<GarminDaysResponse>("/garmin/days?days=90", GARMIN_FALLBACK);
  const restingHr = latestValue(days, "restingHeartRate");
  const sleep = latestValue(days, "sleepDurationHours");
  const hrv = latestValue(days, "hrvLastNightAvg");
  const bodyBattery = latestValue(days, "bodyBatteryHigh");
  const bodyBatteryLow = bodyBattery && days.find((d) => d.day === bodyBattery.day)?.bodyBatteryLow;
  const freshness = freshnessNote(latestDay, lastSyncedAt);

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Recovery</h1>
          <p className="mt-1 text-neutral-400">
            All-day wellness data from Garmin — resting HR, sleep and Body Battery Strava can&rsquo;t see.
          </p>
          <p className={`mt-2 text-xs ${freshness.warn ? "text-amber-400" : "text-neutral-500"}`}>{freshness.text}</p>
        </div>
        <GarminSyncButton />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Resting HR"
          value={restingHr ? `${restingHr.value} bpm` : "—"}
          subtext={restingHr ? shortDate(restingHr.day) : "No day with enough wear yet"}
        />
        <StatCard
          label="Sleep"
          value={sleep ? `${sleep.value.toFixed(1)}h` : "—"}
          subtext={sleep ? `Night ending ${shortDate(sleep.day)}` : "Wear your watch overnight"}
        />
        <StatCard
          label="Body Battery"
          value={bodyBattery ? `${bodyBattery.value}` : "—"}
          subtext={bodyBattery ? `High · low ${bodyBatteryLow ?? "—"} · ${shortDate(bodyBattery.day)}` : undefined}
        />
        <StatCard
          label="HRV"
          value={hrv ? `${Math.round(hrv.value)} ms` : "—"}
          subtext={hrv ? `Night ending ${shortDate(hrv.day)}` : "Not recorded by your watch"}
        />
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
