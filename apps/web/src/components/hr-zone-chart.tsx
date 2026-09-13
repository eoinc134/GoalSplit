"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { BarShapeProps } from "recharts";
import type { HrZoneMinutes } from "@goalsplit/types";

const AXIS_COLOR = "#737373"; // neutral-500
const GRID_COLOR = "#262626"; // neutral-800
const TOOLTIP_STYLE = { backgroundColor: "#171717", border: "1px solid #262626", borderRadius: 8 };

// Fixed intensity gradient, green (easy) to red (max) — distinct from the ACWR
// status palette (band-badge.tsx) and the activity-type hues (weekly-trends-chart.tsx).
const ZONE_COLOR: Record<number, string> = {
  1: "#10b981", // emerald-500
  2: "#0ea5e9", // sky-500
  3: "#f59e0b", // amber-500
  4: "#f97316", // orange-500
  5: "#ef4444", // red-500
};

interface HrZoneChartProps {
  minutesByZone: HrZoneMinutes[];
}

// Cell is deprecated in recharts v3 in favor of a custom `shape` renderer —
// this colors each bar by its own zone rather than one fill for the series.
function ZoneBarShape(props: BarShapeProps) {
  const { x, y, width, height, payload } = props;
  const colorIndex = (payload as { colorIndex: number } | undefined)?.colorIndex ?? 1;
  return <rect x={x} y={y} width={width} height={height} rx={3} ry={3} fill={ZONE_COLOR[colorIndex]} />;
}

export function HrZoneChart({ minutesByZone }: Readonly<HrZoneChartProps>) {
  const totalMinutes = minutesByZone.reduce((sum, z) => sum + z.minutes, 0);

  if (totalMinutes === 0) {
    return <p className="py-16 text-center text-sm text-neutral-500">No time-in-zone data in this window yet.</p>;
  }

  const data = minutesByZone.map((z) => ({ zone: `Z${z.zone}`, minutes: Math.round(z.minutes), colorIndex: z.zone }));

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis dataKey="zone" tick={{ fill: AXIS_COLOR, fontSize: 11 }} stroke={GRID_COLOR} />
          <YAxis
            tick={{ fill: AXIS_COLOR, fontSize: 11 }}
            stroke={GRID_COLOR}
            width={40}
            tickFormatter={(v: number) => `${v}m`}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: "#f5f5f5" }}
            itemStyle={{ color: "#f5f5f5" }}
            formatter={(value) => `${value} min`}
          />
          <Bar dataKey="minutes" shape={ZoneBarShape} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
