"use client";

import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { GarminDayPoint, RestingHrBaselinePoint } from "@goalsplit/types";
import {
  AXIS_COLOR,
  BODY_BATTERY,
  GRID_COLOR,
  REFERENCE_COLOR,
  SERIES,
  SLEEP_STAGES,
  STRESS_BANDS,
  SURFACE_COLOR,
  TOOLTIP_STYLE,
  formatDayTick,
  legendLabel,
} from "./chart-theme";

const xAxis = {
  dataKey: "day",
  tickFormatter: formatDayTick,
  tick: { fill: AXIS_COLOR, fontSize: 11 },
  stroke: GRID_COLOR,
  minTickGap: 24,
};
const yTick = { fill: AXIS_COLOR, fontSize: 11 };
const gap = { stroke: SURFACE_COLOR, strokeWidth: 2 };

function Empty({ message }: Readonly<{ message: string }>) {
  return <p className="py-16 text-center text-sm text-neutral-500">{message}</p>;
}

function TooltipBox({ title, rows }: Readonly<{ title: string; rows: [string, string][] }>) {
  return (
    <div style={TOOLTIP_STYLE} className="px-3 py-2 text-xs text-neutral-100">
      <p className="font-medium">{title}</p>
      {rows.map(([k, v]) => (
        <p key={k}>
          {k}: {v}
        </p>
      ))}
    </div>
  );
}

const hours = (s: number | null) => (s ?? 0) / 3600;
const fmtH = (h: number) => `${Math.floor(h)}h ${String(Math.round((h % 1) * 60)).padStart(2, "0")}m`;

// ── Resting HR against your own baseline ────────────────────────────────────

interface RhrRow {
  day: string;
  restingHr: number;
  baseline: number | null;
  band: [number, number] | null;
  elevated: number | null;
}

export function RestingHrBaselineChart({ points }: Readonly<{ points: RestingHrBaselinePoint[] }>) {
  if (points.length === 0) return <Empty message="No resting HR yet: wear your watch for at least 12 hours a day." />;
  const data: RhrRow[] = points.map((p) => ({
    day: p.day,
    restingHr: p.restingHr,
    baseline: p.baseline,
    band: p.bandLow !== null && p.bandHigh !== null ? [p.bandLow, p.bandHigh] : null,
    elevated: p.elevated ? p.restingHr : null,
  }));

  return (
    <div className="h-60 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis {...xAxis} />
          <YAxis tick={yTick} stroke={GRID_COLOR} width={36} domain={["dataMin - 3", "dataMax + 3"]} allowDecimals={false} />
          <Tooltip
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as RhrRow | undefined;
              if (!active || !row) return null;
              const rows: [string, string][] = [["Resting HR", `${row.restingHr} bpm`]];
              if (row.baseline !== null) {
                const dev = row.restingHr - row.baseline;
                rows.push(["Your 28-day baseline", `${row.baseline.toFixed(1)} bpm`]);
                rows.push(["Difference", `${dev > 0 ? "+" : ""}${dev.toFixed(1)} bpm${row.elevated !== null ? " (elevated)" : ""}`]);
              }
              return <TooltipBox title={formatDayTick(row.day)} rows={rows} />;
            }}
          />
          <Legend itemSorter={null} wrapperStyle={{ fontSize: 12 }} formatter={legendLabel} />
          <Area dataKey="band" name="Normal range (±1 SD)" fill={REFERENCE_COLOR} fillOpacity={0.15} stroke="none" connectNulls={false} />
          <Line dataKey="baseline" name="28-day baseline" stroke={REFERENCE_COLOR} strokeDasharray="5 4" strokeWidth={1.5} dot={false} connectNulls={false} />
          <Line dataKey="restingHr" name="Resting HR" stroke={SERIES.fitness} strokeWidth={2} dot={{ r: 2.5 }} connectNulls />
          <Scatter dataKey="elevated" name="Elevated" fill={STRESS_BANDS.medium} shape="diamond" legendType="diamond" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Sleep stages ────────────────────────────────────────────────────────────

interface SleepRow {
  day: string;
  deep: number;
  rem: number;
  light: number;
  awake: number;
  unstaged: number;
  total: number;
  start: string | null;
  end: string | null;
}

export function SleepStagesChart({ days }: Readonly<{ days: GarminDayPoint[] }>) {
  const data: SleepRow[] = days
    .filter((d) => d.sleepDurationHours !== null)
    .map((d) => {
      const staged = d.deepSleepSeconds !== null || d.remSleepSeconds !== null || d.lightSleepSeconds !== null;
      return {
        day: d.day,
        deep: hours(d.deepSleepSeconds),
        rem: hours(d.remSleepSeconds),
        light: hours(d.lightSleepSeconds),
        awake: hours(d.awakeSleepSeconds),
        unstaged: staged ? 0 : d.sleepDurationHours!,
        total: d.sleepDurationHours!,
        start: d.sleepStartLocal,
        end: d.sleepEndLocal,
      };
    });
  if (data.length === 0) return <Empty message="No sleep recorded in this window: wear your watch overnight." />;
  const anyUnstaged = data.some((r) => r.unstaged > 0);

  return (
    <div className="h-60 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis {...xAxis} />
          <YAxis tick={yTick} stroke={GRID_COLOR} width={32} tickFormatter={(v: number) => `${v}h`} />
          <Tooltip
            cursor={{ fill: GRID_COLOR }}
            content={({ active, payload }) => {
              const r = payload?.[0]?.payload as SleepRow | undefined;
              if (!active || !r) return null;
              const rows: [string, string][] = [["Asleep", fmtH(r.total)]];
              if (r.start && r.end) rows.push(["In bed", `${r.start.slice(11)} → ${r.end.slice(11)}`]);
              if (r.unstaged === 0) {
                rows.push(["Deep", fmtH(r.deep)], ["REM", fmtH(r.rem)], ["Light", fmtH(r.light)], ["Awake", fmtH(r.awake)]);
              }
              return <TooltipBox title={`Night ending ${formatDayTick(r.day)}`} rows={rows} />;
            }}
          />
          <Legend itemSorter={null} wrapperStyle={{ fontSize: 12 }} formatter={legendLabel} />
          <Bar dataKey="deep" name="Deep" stackId="s" fill={SLEEP_STAGES.deep} {...gap} />
          <Bar dataKey="rem" name="REM" stackId="s" fill={SLEEP_STAGES.rem} {...gap} />
          <Bar dataKey="light" name="Light" stackId="s" fill={SLEEP_STAGES.light} {...gap} />
          <Bar dataKey="awake" name="Awake" stackId="s" fill={SLEEP_STAGES.awake} {...gap} />
          {anyUnstaged && <Bar dataKey="unstaged" name="No stage data" stackId="s" fill={SLEEP_STAGES.unstaged} {...gap} />}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Body Battery charged vs drained ─────────────────────────────────────────

export function BodyBatteryChart({ days }: Readonly<{ days: GarminDayPoint[] }>) {
  const data = days
    .filter((d) => d.bodyBatteryCharged !== null || d.bodyBatteryDrained !== null)
    .map((d) => ({ day: d.day, charged: d.bodyBatteryCharged ?? 0, drained: -(d.bodyBatteryDrained ?? 0), high: d.bodyBatteryHigh }));
  if (data.length === 0) return <Empty message="No Body Battery data in this window." />;

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} stackOffset="sign" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis {...xAxis} />
          <YAxis tick={yTick} stroke={GRID_COLOR} width={36} tickFormatter={(v: number) => String(Math.abs(v))} />
          <Tooltip
            cursor={{ fill: GRID_COLOR }}
            content={({ active, payload }) => {
              const r = payload?.[0]?.payload as (typeof data)[number] | undefined;
              if (!active || !r) return null;
              return (
                <TooltipBox
                  title={formatDayTick(r.day)}
                  rows={[
                    ["Charged", `+${r.charged}`],
                    ["Drained", `−${Math.abs(r.drained)}`],
                    ["Peak", r.high !== null ? String(r.high) : "—"],
                  ]}
                />
              );
            }}
          />
          <Legend itemSorter={null} wrapperStyle={{ fontSize: 12 }} formatter={legendLabel} />
          <ReferenceLine y={0} stroke={REFERENCE_COLOR} />
          <Bar dataKey="charged" name="Charged" stackId="bb" fill={BODY_BATTERY.charged} radius={[4, 4, 0, 0]} />
          <Bar dataKey="drained" name="Drained" stackId="bb" fill={BODY_BATTERY.drained} radius={[0, 0, 4, 4]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Stress bands ────────────────────────────────────────────────────────────

export function StressChart({ days }: Readonly<{ days: GarminDayPoint[] }>) {
  const data = days
    .filter((d) => d.stressRestSeconds !== null)
    .map((d) => ({
      day: d.day,
      rest: hours(d.stressRestSeconds),
      low: hours(d.stressLowSeconds),
      medium: hours(d.stressMediumSeconds),
      high: hours(d.stressHighSeconds),
      avg: d.avgStressLevel,
    }));
  if (data.length === 0) return <Empty message="No stress data in this window." />;

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis {...xAxis} />
          <YAxis tick={yTick} stroke={GRID_COLOR} width={32} tickFormatter={(v: number) => `${v}h`} />
          <Tooltip
            cursor={{ fill: GRID_COLOR }}
            content={({ active, payload }) => {
              const r = payload?.[0]?.payload as (typeof data)[number] | undefined;
              if (!active || !r) return null;
              return (
                <TooltipBox
                  title={formatDayTick(r.day)}
                  rows={[
                    ["Rest", fmtH(r.rest)],
                    ["Low", fmtH(r.low)],
                    ["Medium", fmtH(r.medium)],
                    ["High", fmtH(r.high)],
                    ["Average stress", r.avg !== null ? String(r.avg) : "—"],
                  ]}
                />
              );
            }}
          />
          <Legend itemSorter={null} wrapperStyle={{ fontSize: 12 }} formatter={legendLabel} />
          <Bar dataKey="rest" name="Rest" stackId="st" fill={STRESS_BANDS.rest} {...gap} />
          <Bar dataKey="low" name="Low" stackId="st" fill={STRESS_BANDS.low} {...gap} />
          <Bar dataKey="medium" name="Medium" stackId="st" fill={STRESS_BANDS.medium} {...gap} />
          <Bar dataKey="high" name="High" stackId="st" fill={STRESS_BANDS.high} {...gap} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
