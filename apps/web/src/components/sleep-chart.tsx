"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { GarminDayPoint } from "@goalsplit/types";
import { formatDate } from "@/lib/format";

const AXIS_COLOR = "#737373"; // neutral-500
const GRID_COLOR = "#262626"; // neutral-800
const TOOLTIP_STYLE = { backgroundColor: "#171717", border: "1px solid #262626", borderRadius: 8 };
const BAR_COLOR = "#8b5cf6"; // violet-500

interface SleepChartProps {
  days: GarminDayPoint[];
}

export function SleepChart({ days }: Readonly<SleepChartProps>) {
  const data = days
    .filter((d) => d.sleepDurationHours !== null)
    .map((d) => ({ day: d.day, sleepDurationHours: d.sleepDurationHours as number }));

  if (data.length === 0) {
    return <p className="py-16 text-center text-sm text-neutral-500">No sleep data synced yet — click Sync Garmin.</p>;
  }

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
            width={32}
            tickFormatter={(v: number) => `${v}h`}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: "#f5f5f5" }}
            itemStyle={{ color: "#f5f5f5" }}
            labelFormatter={(label) => formatDate(String(label))}
            formatter={(value) => `${Number(value).toFixed(1)}h`}
          />
          <Bar dataKey="sleepDurationHours" name="Sleep" fill={BAR_COLOR} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
