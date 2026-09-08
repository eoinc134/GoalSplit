"use client";

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { WeeklyVolumePoint, WeeklyPacePoint, ActivityType } from "@goalsplit/types";
import { formatPace } from "@/lib/format";

const AXIS_COLOR = "#737373"; // neutral-500
const GRID_COLOR = "#262626"; // neutral-800
const TOOLTIP_STYLE = { backgroundColor: "#171717", border: "1px solid #262626", borderRadius: 8 };

// Fixed order and hues so a chart never reorders/recolors by which types
// happen to have the most volume in a given window. Distinct from both the
// ACWR status palette (band-badge.tsx) and brand-500/orange-500 (nav/Strava).
const TYPE_ORDER: ActivityType[] = ["Run", "Ride", "Swim", "Walk", "Hike"];
const TYPE_COLOR: Record<string, string> = {
  Run: "#0ea5e9", // sky-500
  Ride: "#8b5cf6", // violet-500
  Swim: "#2dd4bf", // teal-400
  Walk: "#e879f9", // fuchsia-400
  Hike: "#e879f9", // fuchsia-400 — shares with Walk, both low-frequency here
};

function formatWeekTick(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "short" });
}

interface WeeklyVolumeChartProps {
  volumeByType: WeeklyVolumePoint[];
}

function pivotVolumeByWeek(points: WeeklyVolumePoint[]) {
  const weeks = new Map<string, Record<string, number | string>>();
  for (const p of points) {
    const row = weeks.get(p.weekStart) ?? { weekStart: p.weekStart };
    row[p.type] = (Number(row[p.type]) || 0) + p.distanceM / 1000; // km
    weeks.set(p.weekStart, row);
  }
  return Array.from(weeks.values()).sort((a, b) => String(a.weekStart).localeCompare(String(b.weekStart)));
}

export function WeeklyVolumeChart({ volumeByType }: Readonly<WeeklyVolumeChartProps>) {
  if (volumeByType.length === 0) {
    return <p className="py-16 text-center text-sm text-neutral-500">No activity volume in this window yet.</p>;
  }

  const data = pivotVolumeByWeek(volumeByType);
  const presentTypes = TYPE_ORDER.filter((t) => volumeByType.some((p) => p.type === t));

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis
            dataKey="weekStart"
            tickFormatter={formatWeekTick}
            tick={{ fill: AXIS_COLOR, fontSize: 11 }}
            stroke={GRID_COLOR}
          />
          <YAxis
            tick={{ fill: AXIS_COLOR, fontSize: 11 }}
            stroke={GRID_COLOR}
            width={36}
            tickFormatter={(v: number) => `${v}km`}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: "#f5f5f5" }}
            itemStyle={{ color: "#f5f5f5" }}
            labelFormatter={(label) => formatWeekTick(String(label))}
            formatter={(value) => `${Number(value).toFixed(1)} km`}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: AXIS_COLOR }} />
          {presentTypes.map((type) => (
            <Bar key={type} dataKey={type} stackId="volume" fill={TYPE_COLOR[type]} radius={[0, 0, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface WeeklyPaceChartProps {
  runPace: WeeklyPacePoint[];
}

export function WeeklyPaceChart({ runPace }: Readonly<WeeklyPaceChartProps>) {
  const data = runPace
    .filter((p) => p.distanceM > 0)
    .map((p) => ({
      weekStart: p.weekStart,
      paceSecPerKm: p.movingTimeS / (p.distanceM / 1000),
    }));

  if (data.length === 0) {
    return <p className="py-16 text-center text-sm text-neutral-500">No Run activity in this window yet.</p>;
  }

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis
            dataKey="weekStart"
            tickFormatter={formatWeekTick}
            tick={{ fill: AXIS_COLOR, fontSize: 11 }}
            stroke={GRID_COLOR}
          />
          {/* Reversed so faster (lower seconds/km) reads as "up" — improvement trends upward. */}
          <YAxis
            reversed
            tick={{ fill: AXIS_COLOR, fontSize: 11 }}
            stroke={GRID_COLOR}
            width={48}
            tickFormatter={(v: number) => formatPace(v)}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: "#f5f5f5" }}
            itemStyle={{ color: "#f5f5f5" }}
            labelFormatter={(label) => formatWeekTick(String(label))}
            formatter={(value) => formatPace(Number(value))}
          />
          <Line dataKey="paceSecPerKm" name="Pace" stroke={TYPE_COLOR.Run} dot={{ r: 3 }} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
