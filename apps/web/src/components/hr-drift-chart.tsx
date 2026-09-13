"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DecouplingResult } from "@goalsplit/types";
import { formatDate } from "@/lib/format";

const AXIS_COLOR = "#737373"; // neutral-500
const GRID_COLOR = "#262626"; // neutral-800
const TOOLTIP_STYLE = { backgroundColor: "#171717", border: "1px solid #262626", borderRadius: 8 };
const LINE_COLOR = "#0ea5e9"; // sky-500
const THRESHOLD_COLOR = "#f59e0b"; // amber-500

// Commonly cited rule of thumb: under ~10% decoupling on a steady run
// suggests good aerobic durability for that effort.
const DECOUPLING_GUIDELINE_PCT = 10;

interface HrDriftChartProps {
  runs: DecouplingResult[];
}

export function HrDriftChart({ runs }: Readonly<HrDriftChartProps>) {
  // Oldest first for a left-to-right trend, and only runs with a computable value.
  const data = runs
    .filter((r) => r.decouplingPct !== null)
    .slice()
    .reverse()
    .map((r) => ({ localDate: r.localDate, decouplingPct: r.decouplingPct as number }));

  if (data.length === 0) {
    return <p className="py-16 text-center text-sm text-neutral-500">No aerobic decoupling data in this window yet.</p>;
  }

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis
            dataKey="localDate"
            tickFormatter={(d: string) => formatDate(d)}
            tick={{ fill: AXIS_COLOR, fontSize: 11 }}
            stroke={GRID_COLOR}
          />
          <YAxis tick={{ fill: AXIS_COLOR, fontSize: 11 }} stroke={GRID_COLOR} width={40} tickFormatter={(v: number) => `${v}%`} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: "#f5f5f5" }}
            itemStyle={{ color: "#f5f5f5" }}
            labelFormatter={(label) => formatDate(String(label))}
            formatter={(value) => `${Number(value).toFixed(1)}%`}
          />
          <ReferenceLine y={DECOUPLING_GUIDELINE_PCT} stroke={THRESHOLD_COLOR} strokeDasharray="4 4" />
          <Line dataKey="decouplingPct" name="Decoupling" stroke={LINE_COLOR} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
