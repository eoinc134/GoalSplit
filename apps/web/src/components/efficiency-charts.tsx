"use client";

import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { EfficiencySummary, WeeklyPaceAtHrPoint } from "@goalsplit/types";
import { formatPace } from "@/lib/format";
import { AXIS_COLOR, GRID_COLOR, SERIES, TOOLTIP_STYLE, TOOLTIP_TEXT, formatDayTick, legendLabel } from "./chart-theme";

function toTs(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getTime();
}

function tsTick(ts: number): string {
  return formatDayTick(new Date(ts).toISOString().slice(0, 10));
}

interface Point {
  ts: number;
  ef: number;
  name: string;
  temp: number | null;
}

function EfTooltip({ active, payload }: Readonly<{ active?: boolean; payload?: { payload: Point & { adjustedEf?: number } }[] }>) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div style={TOOLTIP_STYLE} className="px-3 py-2 text-xs text-neutral-100">
      <p className="font-medium">{tsTick(p.ts)}{p.name ? ` · ${p.name}` : ""}</p>
      <p>EF: {p.ef.toFixed(3)}</p>
      {p.temp !== null && p.temp !== undefined && <p>Temp: {p.temp.toFixed(0)} °C</p>}
    </div>
  );
}

// EF scatter for aerobic runs with a 28-day rolling median — the median line is
// the trend to read; single runs scatter with terrain, weather and sleep.
export function EfficiencyChart({ summary }: Readonly<{ summary: EfficiencySummary }>) {
  const aerobic = summary.runs.filter((r) => r.ef !== null && (r.runClass === "easy" || r.runClass === "recovery" || r.runClass === "long"));
  if (aerobic.length === 0) {
    return <p className="py-16 text-center text-sm text-neutral-500">No easy or long runs with HR streams in this window yet.</p>;
  }

  const toPoint = (r: (typeof aerobic)[number]): Point => ({ ts: toTs(r.localDate), ef: r.ef!, name: r.activityName, temp: r.avgTempC });
  const easy = aerobic.filter((r) => r.runClass !== "long").map(toPoint);
  const long = aerobic.filter((r) => r.runClass === "long").map(toPoint);
  const rolling = summary.rollingEf.map((p) => ({ ts: toTs(p.localDate), ef: p.ef, adjustedEf: p.adjustedEf, name: "28-day median", temp: null }));
  const hasAdjusted = summary.temperatureModel !== null && rolling.some((p) => p.adjustedEf !== null);

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={tsTick}
            tick={{ fill: AXIS_COLOR, fontSize: 11 }}
            stroke={GRID_COLOR}
            minTickGap={32}
          />
          <YAxis
            dataKey="ef"
            type="number"
            domain={["auto", "auto"]}
            tick={{ fill: AXIS_COLOR, fontSize: 11 }}
            stroke={GRID_COLOR}
            width={44}
            tickFormatter={(v: number) => v.toFixed(2)}
          />
          <Tooltip content={<EfTooltip />} />
          <Legend itemSorter={null} wrapperStyle={{ fontSize: 12 }} formatter={legendLabel} />
          <Scatter data={easy} name="Easy / recovery" fill={SERIES.easy} shape="circle" />
          <Scatter data={long} name="Long" fill={SERIES.long} shape="triangle" legendType="triangle" />
          <Line data={rolling} dataKey="ef" name="28-day median" stroke={SERIES.trend} strokeWidth={2} dot={false} />
          {hasAdjusted && (
            <Line
              data={rolling}
              dataKey="adjustedEf"
              name="Temperature-adjusted median"
              stroke={SERIES.adjusted}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PaceAtHrChart({ weekly }: Readonly<{ weekly: WeeklyPaceAtHrPoint[] }>) {
  const data = weekly.filter((w) => w.gapPaceSecPerKm !== null);
  if (data.length === 0) {
    return <p className="py-16 text-center text-sm text-neutral-500">Fewer than 10 minutes in the HR band in any week so far.</p>;
  }

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={weekly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis dataKey="weekStart" tickFormatter={formatDayTick} tick={{ fill: AXIS_COLOR, fontSize: 11 }} stroke={GRID_COLOR} minTickGap={24} />
          {/* Reversed so faster (lower s/km) reads as "up". */}
          <YAxis
            reversed
            domain={["auto", "auto"]}
            tick={{ fill: AXIS_COLOR, fontSize: 11 }}
            stroke={GRID_COLOR}
            width={56}
            tickFormatter={(v: number) => formatPace(v)}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={TOOLTIP_TEXT}
            itemStyle={TOOLTIP_TEXT}
            labelFormatter={(label) => `Week of ${formatDayTick(String(label))}`}
            formatter={(value, _name, item) => {
              const minutes = Math.round((item.payload as WeeklyPaceAtHrPoint).seconds / 60);
              return [`${formatPace(Number(value))} (${minutes} min in band)`, "GAP pace"];
            }}
          />
          <Line dataKey="gapPaceSecPerKm" name="GAP pace" stroke={SERIES.easy} strokeWidth={2} dot={{ r: 4 }} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
