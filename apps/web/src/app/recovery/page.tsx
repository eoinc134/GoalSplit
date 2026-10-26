import { StatCard } from "@/components/stat-card";
import { GarminSyncButton } from "@/components/garmin-sync-button";
import { BodyBatteryChart, RestingHrBaselineChart, SleepStagesChart, StressChart } from "@/components/recovery-charts";
import { NextMorningTable, ReadinessCard } from "@/components/recovery-insights";
import { serverFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { GARMIN_FALLBACK, latestValue } from "@/lib/garmin";
import type { GarminDayPoint, GarminDaysResponse, RecoverySummary, RestingHrBaselinePoint } from "@goalsplit/types";

const RECOVERY_FALLBACK: RecoverySummary = { restingHr: [], bedtime: null, nextMorning: [], readiness: null };
const STALE_AFTER_DAYS = 2;
const DETAIL_DAYS = 30; // sleep, Body Battery and stress charts

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

// Share of the day's monitored time Garmin classed as "rest".
function restShare(d: GarminDayPoint | undefined): number | null {
  if (!d || d.stressRestSeconds === null) return null;
  const total = d.stressRestSeconds + (d.stressLowSeconds ?? 0) + (d.stressMediumSeconds ?? 0) + (d.stressHighSeconds ?? 0);
  return total > 0 ? (100 * d.stressRestSeconds) / total : null;
}

function restingHrSubtext(latest: { day: string } | null, point: RestingHrBaselinePoint | undefined): string {
  if (!latest) return "No day with enough wear yet";
  if (point?.day === latest.day && point.baseline !== null) {
    return `${shortDate(latest.day)} · baseline ${point.baseline.toFixed(0)}`;
  }
  return shortDate(latest.day);
}

function Card({ title, note, children }: Readonly<{ title: string; note?: React.ReactNode; children: React.ReactNode }>) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {note && <p className="mt-1 text-xs text-neutral-500">{note}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}

export default async function RecoveryPage() {
  const [{ days, latestDay, lastSyncedAt }, recovery] = await Promise.all([
    serverFetch<GarminDaysResponse>("/garmin/days?days=90", GARMIN_FALLBACK),
    serverFetch<RecoverySummary>("/garmin/recovery?days=90", RECOVERY_FALLBACK),
  ]);
  const restingHr = latestValue(days, "restingHeartRate");
  const sleep = latestValue(days, "sleepDurationHours");
  const hrv = latestValue(days, "hrvLastNightAvg");
  const bodyBattery = latestValue(days, "bodyBatteryHigh");
  const stressRest = days.findLast((d) => d.stressRestSeconds !== null);
  const latestRhrPoint = recovery.restingHr.at(-1);
  const freshness = freshnessNote(latestDay, lastSyncedAt);
  const recent = days.slice(-DETAIL_DAYS);
  const bedtime = recovery.bedtime;

  const restSharePct = restShare(stressRest);

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Recovery</h1>
          <p className="mt-1 text-neutral-400">
            All-day wellness data from Garmin — what Strava can&rsquo;t see — set against your own normal and your training.
          </p>
          <p className={`mt-2 text-xs ${freshness.warn ? "text-amber-400" : "text-neutral-500"}`}>{freshness.text}</p>
        </div>
        <GarminSyncButton />
      </div>

      <ReadinessCard readiness={recovery.readiness} />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Resting HR"
          value={restingHr ? `${restingHr.value} bpm` : "—"}
          subtext={restingHrSubtext(restingHr, latestRhrPoint)}
        />
        <StatCard
          label="Sleep"
          value={sleep ? `${sleep.value.toFixed(1)}h` : "—"}
          subtext={sleep ? `Night ending ${shortDate(sleep.day)}` : "Wear your watch overnight"}
        />
        <StatCard
          label="Body Battery"
          value={bodyBattery ? `${bodyBattery.value}` : "—"}
          subtext={bodyBattery ? `Peak · ${shortDate(bodyBattery.day)}` : undefined}
        />
        <StatCard
          label="Time at rest"
          value={restSharePct !== null ? `${Math.round(restSharePct)}%` : "—"}
          subtext={stressRest ? `Of monitored time · ${shortDate(stressRest.day)}` : undefined}
        />
        {hrv && <StatCard label="HRV" value={`${Math.round(hrv.value)} ms`} subtext={`Night ending ${shortDate(hrv.day)}`} />}
      </div>

      <Card
        title="Resting heart rate (90 days)"
        note="Against your own 28-day baseline. A morning well above your normal range is an early sign of fatigue or illness; diamonds mark those more than 2 SD and 3+ bpm above it."
      >
        <RestingHrBaselineChart points={recovery.restingHr} />
      </Card>

      <Card
        title="After a hard day"
        note="How the next morning has looked after rest days and after your easier, moderate and hardest third of training days (by TRIMP), across all your history. Means with 95% intervals; small n means a wide interval."
      >
        <NextMorningTable groups={recovery.nextMorning} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title={`Sleep (${DETAIL_DAYS} days)`}
          note={
            bedtime
              ? `Usual bedtime ${bedtime.meanBedtime}, waking ${bedtime.meanWake}; bedtime varies by about ${bedtime.sdMinutes} min (last ${bedtime.nights} nights).`
              : "Bedtime consistency appears after 5 nights with the watch on."
          }
        >
          <SleepStagesChart days={recent} />
        </Card>
        <Card title={`Body Battery (${DETAIL_DAYS} days)`} note="Energy charged (mostly overnight) against energy drained each day.">
          <BodyBatteryChart days={recent} />
        </Card>
        <Card title={`Stress (${DETAIL_DAYS} days)`} note="Hours in each Garmin stress band, from heart-rate variability while you're still.">
          <StressChart days={recent} />
        </Card>
      </div>
    </div>
  );
}
