"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { GarminDayPoint } from "@goalsplit/types";
import { formatDate } from "@/lib/format";

const AXIS_COLOR = "#737373"; // neutral-500
const GRID_COLOR = "#262626"; // neutral-800
const TOOLTIP_STYLE = { backgroundColor: "#171717", border: "1px solid #262626", borderRadius: 8 };
const LINE_COLOR = "#10b981"; // emerald-500 — recovery/readiness family, distinct from training-load's sky-500

interface RestingHrChartProps {
  days: GarminDayPoint[];
}

export function RestingHrChart({ days }: Readonly<RestingHrChartProps>) {
  const data = days
    .filter((d) => d.restingHeartRate !== null)
    .map((d) => ({ day: d.day, restingHeartRate: d.restingHeartRate as number }));

  if (data.length === 0) {
    return <p className="py-16 text-center text-sm text-neutral-500">No Garmin data synced yet — click Sync Garmin.</p>;
  }

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis
            dataKey="day"
            tickFormatter={(d: string) => formatDate(d)}
            tick={{ fill: AXIS_COLOR, fontSize: 11 }}
            stroke={GRID_COLOR}
          />
          <YAxis
            tick={{ fill: AXIS_COLOR, fontSize: 11 }}
            stroke={GRID_COLOR}
            width={40}
            tickFormatter={(v: number) => `${v}`}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: "#f5f5f5" }}
            itemStyle={{ color: "#f5f5f5" }}
            labelFormatter={(label) => formatDate(String(label))}
            formatter={(value) => `${value} bpm`}
          />
          <Line dataKey="restingHeartRate" name="Resting HR" stroke={LINE_COLOR} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
