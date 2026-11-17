import { TeaserCard } from "@/components/teaser-card";
import { BandBadge } from "@/components/band-badge";
import { StravaConnect } from "@/components/strava-connect";
import { PlanCard } from "@/components/plan-card";
import { CoachNote } from "@/components/coach-note";
import { LoadErrorBanner, Loadable } from "@/components/states";
import { failures, load, type LoadError } from "@/lib/server-api";
import { latestValue } from "@/lib/garmin";
import { GARMIN_FALLBACK } from "@/lib/fallbacks";
import { formatDate } from "@/lib/format";
import type { GarminDaysResponse, PlanAdherence, WeeklyNote, WeeklyReview } from "@goalsplit/types";

const UNAVAILABLE = "Couldn't load";

function Section({
  title,
  note,
  error = null,
  children,
}: Readonly<{ title: string; note?: React.ReactNode; error?: LoadError | null; children: React.ReactNode }>) {
  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {note && !error && <p className="mt-1 text-xs text-neutral-500">{note}</p>}
      <div className="mt-4">
        <Loadable error={error} size="sm">
          {children}
        </Loadable>
      </div>
    </section>
  );
}

function km(metres: number): string {
  return `${(metres / 1000).toFixed(1)} km`;
}

function weekKmSubtext(review: WeeklyReview | null): string {
  const [last, current] = (review?.weekly ?? []).slice(-2);
  if (!current) return "No data yet";
  const sofar = `${current.daysElapsed} of 7 days`;
  return last ? `${sofar} · last week ${km(last.training.runDistanceM)}` : sofar;
}

export default async function DashboardPage() {
  const [reviewLoad, garminLoad, planLoad, notesLoad] = await Promise.all([
    load<WeeklyReview | null>("/training/weekly-review?weeks=2&format=json", null),
    load<GarminDaysResponse>("/garmin/days?days=14", GARMIN_FALLBACK),
    load<PlanAdherence | null>("/plan/adherence", null),
    load<WeeklyNote[]>("/plan/notes?limit=1", []),
  ]);
  const review = reviewLoad.data;
  const thisWeek = review?.weekly.at(-1);
  const restingHr = latestValue(garminLoad.data.days, "restingHeartRate");

  let ctlSubtext: React.ReactNode = "Keep syncing for a reading";
  if (reviewLoad.error) ctlSubtext = UNAVAILABLE;
  else if (review?.current.band) ctlSubtext = <BandBadge band={review.current.band} />;

  let rhrSubtext = "Sync Garmin to unlock";
  if (garminLoad.error) rhrSubtext = UNAVAILABLE;
  else if (restingHr) rhrSubtext = `via Garmin · ${formatDate(restingHr.day)}`;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-neutral-400">This week, the training plan, and Claude&rsquo;s latest review</p>
      </div>

      <StravaConnect onlyWhenActionNeeded />

      <LoadErrorBanner errors={failures(reviewLoad, garminLoad, planLoad, notesLoad)} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <TeaserCard
          href="/training"
          label="This week"
          value={reviewLoad.error || !thisWeek ? "—" : km(thisWeek.training.runDistanceM)}
          subtext={reviewLoad.error ? UNAVAILABLE : weekKmSubtext(review)}
        />
        <TeaserCard
          href="/training"
          label="Fitness (CTL)"
          value={review && !reviewLoad.error ? review.current.ctl.toFixed(0) : "—"}
          subtext={ctlSubtext}
        />
        <TeaserCard
          href="/recovery"
          label="Resting HR"
          value={restingHr ? `${restingHr.value} bpm` : "—"}
          subtext={rhrSubtext}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Section
            title="Training plan"
            error={planLoad.error}
            note="Progress against the study's pre-registered criteria. The study's verdict comes from the research follow-up."
          >
            <PlanCard adherence={planLoad.data} />
          </Section>
        </div>
        <div className="lg:col-span-2">
          <Section title="Weekly review" error={notesLoad.error} note="Written by Claude from the Training, Recovery and plan data.">
            <CoachNote note={notesLoad.data[0] ?? null} />
          </Section>
        </div>
      </div>
    </div>
  );
}
