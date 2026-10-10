"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DailyLoadPoint, WeeklyLoadPoint } from "@goalsplit/types";
import {
  AXIS_COLOR,
  GRID_COLOR,
  REFERENCE_COLOR,
  SERIES,
  TOOLTIP_STYLE,
  TOOLTIP_TEXT,
  formatDayTick,
  legendLabel,
} from "./chart-theme";

// Foster's commonly cited threshold: weekly monotony above ~2 alongside high
// strain preceded illness/overtraining in his cohort.
const HIGH_MONOTONY = 2;

function Empty({ message }: Readonly<{ message: string }>) {
  return <p className="py-16 text-center text-sm text-neutral-500">{message}</p>;
}

const xAxisProps = {
  tickFormatter: formatDayTick,
  tick: { fill: AXIS_COLOR, fontSize: 11 },
  stroke: GRID_COLOR,
  minTickGap: 32,
};

// CTL and ATL share a unit (TRIMP/day), so one axis is honest here.
export function FitnessFatigueChart({ daily }: Readonly<{ daily: DailyLoadPoint[] }>) {
  if (!daily.some((d) => d.ctl > 0 || d.atl > 0)) return <Empty message="No training load in this window yet." />;

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis dataKey="date" {...xAxisProps} />
          <YAxis tick={{ fill: AXIS_COLOR, fontSize: 11 }} stroke={GRID_COLOR} width={36} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={TOOLTIP_TEXT}
            itemStyle={TOOLTIP_TEXT}
            labelFormatter={(label) => formatDayTick(String(label))}
            formatter={(value) => Number(value).toFixed(1)}
          />
          <Legend itemSorter={null} wrapperStyle={{ fontSize: 12 }} formatter={legendLabel} />
          <Line dataKey="ctl" name="Fitness (CTL)" stroke={SERIES.fitness} strokeWidth={2} dot={false} />
          <Line dataKey="atl" name="Fatigue (ATL)" stroke={SERIES.fatigue} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function FormChart({ daily }: Readonly<{ daily: DailyLoadPoint[] }>) {
  if (!daily.some((d) => d.ctl > 0)) return <Empty message="No training load in this window yet." />;

  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis dataKey="date" {...xAxisProps} />
          <YAxis tick={{ fill: AXIS_COLOR, fontSize: 11 }} stroke={GRID_COLOR} width={36} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={TOOLTIP_TEXT}
            itemStyle={TOOLTIP_TEXT}
            labelFormatter={(label) => formatDayTick(String(label))}
            formatter={(value) => [Number(value).toFixed(1), "Form (TSB)"]}
          />
          <ReferenceLine y={0} stroke={REFERENCE_COLOR} />
          <Line dataKey="tsb" name="Form (TSB)" stroke={SERIES.form} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DailyLoadChart({ daily, referenceLoad }: Readonly<{ daily: DailyLoadPoint[]; referenceLoad: number }>) {
  if (!daily.some((d) => d.activityCount > 0)) return <Empty message="No training load in this window yet." />;

  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis dataKey="date" {...xAxisProps} />
          <YAxis tick={{ fill: AXIS_COLOR, fontSize: 11 }} stroke={GRID_COLOR} width={36} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={TOOLTIP_TEXT}
            itemStyle={TOOLTIP_TEXT}
            cursor={{ fill: GRID_COLOR }}
            labelFormatter={(label) => formatDayTick(String(label))}
            formatter={(value) => [Math.round(Number(value)), "TRIMP"]}
          />
          <ReferenceLine y={referenceLoad} stroke={REFERENCE_COLOR} strokeDasharray="4 4" />
          <Bar dataKey="load" fill={SERIES.load} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface WeeklyTooltipProps {
  active?: boolean;
  payload?: { payload: WeeklyLoadPoint }[];
}

function WeeklyTooltip({ active, payload }: Readonly<WeeklyTooltipProps>) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div style={TOOLTIP_STYLE} className="px-3 py-2 text-xs text-neutral-100">
      <p className="font-medium">Week of {formatDayTick(p.weekStart)}{p.isPartialWeek ? " (so far)" : ""}</p>
      <p>Load: {Math.round(p.load)}</p>
      <p>Monotony: {p.monotony !== null ? p.monotony.toFixed(2) : "—"}</p>
      <p>Strain: {p.strain !== null ? Math.round(p.strain) : "—"}</p>
    </div>
  );
}

export function WeeklyLoadChart({ weekly }: Readonly<{ weekly: WeeklyLoadPoint[] }>) {
  if (!weekly.some((w) => w.load > 0)) return <Empty message="No weekly load yet." />;

  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={weekly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis dataKey="weekStart" {...xAxisProps} />
          <YAxis tick={{ fill: AXIS_COLOR, fontSize: 11 }} stroke={GRID_COLOR} width={40} />
          <Tooltip content={<WeeklyTooltip />} cursor={{ fill: GRID_COLOR }} />
          <Bar dataKey="load" fill={SERIES.load} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MonotonyChart({ weekly }: Readonly<{ weekly: WeeklyLoadPoint[] }>) {
  if (!weekly.some((w) => w.monotony !== null)) return <Empty message="Not enough varied training to compute monotony yet." />;

  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={weekly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis dataKey="weekStart" {...xAxisProps} />
          <YAxis tick={{ fill: AXIS_COLOR, fontSize: 11 }} stroke={GRID_COLOR} width={36} domain={[0, "auto"]} />
          <Tooltip content={<WeeklyTooltip />} />
          <ReferenceLine y={HIGH_MONOTONY} stroke={REFERENCE_COLOR} strokeDasharray="4 4" />
          <Line dataKey="monotony" name="Monotony" stroke={SERIES.load} strokeWidth={2} dot={{ r: 4 }} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
