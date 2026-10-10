"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { WeeklyIntensityPoint } from "@goalsplit/types";
import { AXIS_COLOR, GRID_COLOR, INTENSITY, SURFACE_COLOR, TOOLTIP_STYLE, formatDayTick, legendLabel } from "./chart-theme";
import { PROFILE_LABEL } from "./intensity-profile";

interface Row {
  weekStart: string;
  low: number;
  moderate: number;
  high: number;
  point: WeeklyIntensityPoint;
}

function toRows(weekly: WeeklyIntensityPoint[]): Row[] {
  return weekly.map((w) => {
    const total = w.lowMinutes + w.moderateMinutes + w.highMinutes;
    const pct = (m: number) => (total > 0 ? (m / total) * 100 : 0);
    return { weekStart: w.weekStart, low: pct(w.lowMinutes), moderate: pct(w.moderateMinutes), high: pct(w.highMinutes), point: w };
  });
}

function IntensityTooltip({ active, payload }: Readonly<{ active?: boolean; payload?: { payload: Row }[] }>) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const p = row.point;
  return (
    <div style={TOOLTIP_STYLE} className="px-3 py-2 text-xs text-neutral-100">
      <p className="font-medium">Week of {formatDayTick(p.weekStart)}{p.isPartialWeek ? " (so far)" : ""}</p>
      <p>Low (Z1–2): {Math.round(p.lowMinutes)} min · {Math.round(row.low)}%</p>
      <p>Moderate (Z3): {Math.round(p.moderateMinutes)} min · {Math.round(row.moderate)}%</p>
      <p>High (Z4–5): {Math.round(p.highMinutes)} min · {Math.round(row.high)}%</p>
      <p className="mt-1 text-neutral-400">
        {PROFILE_LABEL[p.profile]}
        {p.polarizationIndex !== null ? ` · PI ${p.polarizationIndex.toFixed(2)}` : ""}
      </p>
    </div>
  );
}

// 100%-stacked so weeks of different volume compare on distribution alone;
// absolute minutes live in the tooltip.
export function IntensityChart({ weekly }: Readonly<{ weekly: WeeklyIntensityPoint[] }>) {
  if (!weekly.some((w) => w.lowMinutes + w.moderateMinutes + w.highMinutes > 0)) {
    return <p className="py-16 text-center text-sm text-neutral-500">No heart-rate time in this window yet.</p>;
  }

  const bar = { stackId: "i", stroke: SURFACE_COLOR, strokeWidth: 2 };
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={toRows(weekly)} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis dataKey="weekStart" tickFormatter={formatDayTick} tick={{ fill: AXIS_COLOR, fontSize: 11 }} stroke={GRID_COLOR} minTickGap={24} />
          <YAxis
            tick={{ fill: AXIS_COLOR, fontSize: 11 }}
            stroke={GRID_COLOR}
            width={40}
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            allowDataOverflow
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip content={<IntensityTooltip />} cursor={{ fill: GRID_COLOR }} />
          <Legend itemSorter={null} wrapperStyle={{ fontSize: 12 }} formatter={legendLabel} />
          <Bar dataKey="low" name="Low (Z1–2)" fill={INTENSITY.low} {...bar} />
          <Bar dataKey="moderate" name="Moderate (Z3)" fill={INTENSITY.moderate} {...bar} />
          <Bar dataKey="high" name="High (Z4–5)" fill={INTENSITY.high} {...bar} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
