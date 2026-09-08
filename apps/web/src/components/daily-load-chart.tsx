"use client";

import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DailyLoadPoint } from "@goalsplit/types";

interface DailyLoadChartProps {
  daily: DailyLoadPoint[];
  chronicAvgLoad: number;
}

const AXIS_COLOR = "#737373"; // neutral-500
const GRID_COLOR = "#262626"; // neutral-800
const BAR_COLOR = "#0ea5e9"; // sky-500 — reserved for load, distinct from brand/status hues
const REFERENCE_COLOR = "#f59e0b"; // amber-500

function formatTick(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "short" });
}

export function DailyLoadChart({ daily, chronicAvgLoad }: Readonly<DailyLoadChartProps>) {
  const hasData = daily.some((d) => d.activityCount > 0);

  if (!hasData) {
    return <p className="py-16 text-center text-sm text-neutral-500">No training load data in this window yet.</p>;
  }

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatTick}
            interval={3}
            tick={{ fill: AXIS_COLOR, fontSize: 11 }}
            stroke={GRID_COLOR}
          />
          <YAxis tick={{ fill: AXIS_COLOR, fontSize: 11 }} stroke={GRID_COLOR} width={32} />
          <Tooltip
            contentStyle={{ backgroundColor: "#171717", border: "1px solid #262626", borderRadius: 8 }}
            labelStyle={{ color: "#f5f5f5" }}
            itemStyle={{ color: "#f5f5f5" }}
            labelFormatter={(label) => formatTick(String(label))}
            formatter={(value) => [Math.round(Number(value)), "Load"]}
          />
          <ReferenceLine y={chronicAvgLoad} stroke={REFERENCE_COLOR} strokeDasharray="4 4" />
          <Bar dataKey="load" fill={BAR_COLOR} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
