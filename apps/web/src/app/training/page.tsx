import { StatCard } from "@/components/stat-card";
import { BandBadge } from "@/components/band-badge";
import { DailyLoadChart, FitnessFatigueChart, FormChart, MonotonyChart, WeeklyLoadChart } from "@/components/load-charts";
import { WeeklyVolumeChart, WeeklyPaceChart } from "@/components/weekly-trends-chart";
import { HrZoneChart } from "@/components/hr-zone-chart";
import { HrDriftChart } from "@/components/hr-drift-chart";
import { IntensityChart } from "@/components/intensity-chart";
import { PROFILE_LABEL } from "@/components/intensity-profile";
import { EfficiencyChart, PaceAtHrChart } from "@/components/efficiency-charts";
import { DurabilityTable, LongRunsTable } from "@/components/long-runs-table";
import { StreamsBackfillPrompt } from "@/components/streams-backfill-prompt";
import { serverFetch } from "@/lib/api";
import { METHODS_URL } from "@/lib/constants";
import {
  EFFICIENCY_FALLBACK,
  HR_DRIFT_FALLBACK,
  HR_ZONES_FALLBACK,
  INTENSITY_FALLBACK,
  LOAD_FALLBACK,
  LONG_RUNS_FALLBACK,
  TRENDS_FALLBACK,
} from "@/lib/analytics-fallbacks";
import type {
  AthletePhysiology,
  EfficiencySummary,
  HrDriftSummary,
  HrZoneSummary,
  IntensitySummary,
  LongRunSummary,
  PerformanceTrends,
  TrainingLoadSummary,
} from "@goalsplit/types";

function signed(v: number, digits = 1): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;
}

function Card({ title, note, children }: Readonly<{ title: string; note?: React.ReactNode; children: React.ReactNode }>) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <h3 className="text-base font-semibold">{title}</h3>
      {note && <p className="mt-1 text-xs text-neutral-500">{note}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}

function SectionHeader({ title, anchor }: Readonly<{ title: string; anchor: string }>) {
  return (
    <div className="flex items-baseline justify-between">
      <h2 className="text-xs font-medium uppercase tracking-wider text-neutral-500">{title}</h2>
      <a href={`${METHODS_URL}#${anchor}`} className="text-xs text-neutral-500 transition-colors hover:text-neutral-300">
        How this is calculated →
      </a>
    </div>
  );
}

function modelNote(p: AthletePhysiology): string {
  const hrMax = p.hrMax !== null ? `HRmax ${p.hrMax}` : "no HRmax yet";
  const rest = p.hrRestSource === "garmin" ? `HRrest ${p.hrRest} (Garmin 90-day median)` : `HRrest ${p.hrRest} (default — sync Garmin)`;
  const k = p.sex ? `k ${p.trimpCoefficient}` : `k ${p.trimpCoefficient} (default — reconnect Strava to read profile sex)`;
  return `Banister TRIMP · ${hrMax} · ${rest} · ${k}`;
}

export default async function TrainingPage() {
  const [load, trends, hrZones, hrDrift, intensity, efficiency, longRuns] = await Promise.all([
    serverFetch<TrainingLoadSummary>("/training/load?days=90", LOAD_FALLBACK),
    serverFetch<PerformanceTrends>("/training/trends?weeks=12", TRENDS_FALLBACK),
    serverFetch<HrZoneSummary>("/training/hr-zones?days=28", HR_ZONES_FALLBACK),
    serverFetch<HrDriftSummary>("/training/hr-drift?days=90&limit=30", HR_DRIFT_FALLBACK),
    serverFetch<IntensitySummary>("/training/intensity?weeks=12", INTENSITY_FALLBACK),
    serverFetch<EfficiencySummary>("/training/efficiency?days=180", EFFICIENCY_FALLBACK),
    serverFetch<LongRunSummary>("/training/long-runs?days=365", LONG_RUNS_FALLBACK),
  ]);
  const { current, coverage } = load;
  const tempModel = efficiency.temperatureModel;

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Training</h1>
        <p className="mt-1 text-neutral-400">Load, intensity, aerobic efficiency and long-run durability</p>
      </div>

      {load.insufficientHistory && (
        <div className="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm text-neutral-400">
          Under 42 days of history — fitness (CTL) is still warming up, so read load figures as provisional.
        </div>
      )}

      {/* ── Load ─────────────────────────────────────────────────────────── */}
      <section className="space-y-6">
        <SectionHeader title="Load" anchor="training-load" />
        <p className="text-xs text-neutral-500">{modelNote(load.physiology)}</p>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Fitness (CTL)" value={current.ctl.toFixed(0)} subtext={`${signed(current.rampRate)} over 7 days`} />
          <StatCard label="Fatigue (ATL)" value={current.atl.toFixed(0)} subtext={`7-day load ${Math.round(current.load7d)}`} />
          <StatCard label="Form (TSB)" value={signed(current.tsb, 0)} subtext="Yesterday's fitness − fatigue" />
          <StatCard
            label="ACWR (EWMA)"
            value={current.acwr !== null ? current.acwr.toFixed(2) : "—"}
            subtext={current.monotony7d !== null ? `Monotony ${current.monotony7d.toFixed(2)}` : undefined}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm text-neutral-400">
          {current.band && (
            <span className="flex items-center gap-2">
              Status: <BandBadge band={current.band} />
            </span>
          )}
          <span>
            HR coverage (7 days): {coverage.coveragePct !== null ? `${coverage.coveragePct}%` : "—"}
            {coverage.averageScored > 0 && ` · ${coverage.averageScored} scored from average HR only`}
          </span>
        </div>

        <Card title="Fitness & fatigue (90 days)" note="42- and 7-day exponentially weighted averages of daily TRIMP.">
          <FitnessFatigueChart daily={load.daily} />
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Form (TSB)" note="Positive = fresh, around −10 to −30 = productive overload, below that = deep fatigue.">
            <FormChart daily={load.daily} />
          </Card>
          <Card title="Daily TRIMP" note="Dashed line: current fitness (CTL) — a typical day's load.">
            <DailyLoadChart daily={load.daily} referenceLoad={current.ctl} />
          </Card>
          <Card title="Weekly load" note="Hover for monotony and strain.">
            <WeeklyLoadChart weekly={load.weekly} />
          </Card>
          <Card title="Weekly monotony (Foster)" note="Mean ÷ SD of daily load. Above ~2 (dashed) = too little day-to-day variation.">
            <MonotonyChart weekly={load.weekly} />
          </Card>
        </div>
      </section>

      {/* ── Volume ───────────────────────────────────────────────────────── */}
      <section className="space-y-6 border-t border-neutral-800 pt-8">
        <SectionHeader title="Volume" anchor="volume" />
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Weekly volume">
            <WeeklyVolumeChart volumeByType={trends.volumeByType} />
          </Card>
          <Card title="Weekly run pace" note="Raw average across every run — mixes easy days and workouts; see Aerobic efficiency below for a like-for-like trend.">
            <WeeklyPaceChart runPace={trends.runPace} />
          </Card>
        </div>
      </section>

      {/* ── Intensity ────────────────────────────────────────────────────── */}
      <section className="space-y-6 border-t border-neutral-800 pt-8">
        <SectionHeader title="Intensity distribution" anchor="intensity-distribution" />
        <div className="grid gap-6 lg:grid-cols-2">
          <Card
            title="Weekly intensity (3-zone)"
            note={
              intensity.overall.profile !== "insufficient-data"
                ? `12 weeks: ${Math.round(intensity.overall.lowPct ?? 0)}% low · ${PROFILE_LABEL[intensity.overall.profile]}${
                    intensity.overall.polarizationIndex !== null ? ` · PI ${intensity.overall.polarizationIndex.toFixed(2)}` : ""
                  }`
                : "Share of HR time below Z3, at Z3, and above."
            }
          >
            {intensity.streamsCoveragePct === 0 ? <StreamsBackfillPrompt /> : <IntensityChart weekly={intensity.weekly} />}
          </Card>
          <Card
            title="Time in HR zone (28 days)"
            note={
              hrZones.zoneModel === "karvonen"
                ? `Karvonen (heart-rate reserve) zones, resting HR ${hrZones.restingHeartRateEstimate} bpm from Garmin.`
                : "%-of-max zones from your highest recorded HR — sync Garmin for resting-HR-based (Karvonen) zones."
            }
          >
            {hrZones.streamsCount === 0 ? <StreamsBackfillPrompt /> : <HrZoneChart minutesByZone={hrZones.minutesByZone} />}
          </Card>
        </div>
      </section>

      {/* ── Aerobic efficiency ───────────────────────────────────────────── */}
      <section className="space-y-6 border-t border-neutral-800 pt-8">
        <SectionHeader title="Aerobic efficiency" anchor="aerobic-efficiency" />

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <StatCard
            label="Efficiency factor (28 days)"
            value={efficiency.recentMedianEf !== null ? efficiency.recentMedianEf.toFixed(3) : "—"}
            subtext="Median, easy + long runs"
          />
          <StatCard
            label="vs previous 28 days"
            value={efficiency.efChangePct !== null ? `${signed(efficiency.efChangePct)}%` : "—"}
            subtext="Higher = more speed per heartbeat"
          />
          <StatCard
            label="Temperature effect"
            value={tempModel ? `${signed(tempModel.pctPerDegC, 2)}%/°C` : "—"}
            subtext={tempModel ? `OLS over ${tempModel.n} runs, R² ${tempModel.r2.toFixed(2)}` : "Needs 15+ runs with temperature"}
          />
        </div>

        {efficiency.streamsCoveragePct === 0 ? (
          <StreamsBackfillPrompt />
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Efficiency factor (180 days)" note="Grade-adjusted speed (m/min) ÷ average HR, aerobic runs ≥20 min only.">
              <EfficiencyChart summary={efficiency} />
            </Card>
            <Card
              title={efficiency.band ? `Pace at ${efficiency.band.minBpm}–${efficiency.band.maxBpm} bpm` : "Pace at fixed HR"}
              note="Weekly grade-adjusted pace while HR sat in Z2, across all runs."
            >
              <PaceAtHrChart weekly={efficiency.weeklyPaceAtHr} />
            </Card>
          </div>
        )}
      </section>

      {/* ── Long runs ────────────────────────────────────────────────────── */}
      <section className="space-y-6 border-t border-neutral-800 pt-8">
        <SectionHeader title="Long runs & durability" anchor="long-runs" />
        <p className="text-xs text-neutral-500">{longRuns.definition}</p>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card title="Durability by duration" note="Median drift and fade per duration band, last 12 months.">
            <DurabilityTable bins={longRuns.durability} />
          </Card>
          <div className="lg:col-span-2">
            <Card title="Aerobic decoupling (runs ≥20 min, 90 days)" note="Grade-adjusted Pa:HR drift, first vs second half. Under ~5% is well coupled; over ~10% the effort outran aerobic fitness.">
              {hrDrift.streamsCount === 0 ? <StreamsBackfillPrompt /> : <HrDriftChart runs={hrDrift.runs} />}
            </Card>
          </div>
        </div>

        <Card title="Long runs (12 months)">
          <LongRunsTable runs={longRuns.runs} />
        </Card>
      </section>
    </div>
  );
}
