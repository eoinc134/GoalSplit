// Shared chart styling for the analytics charts. Series hues are the
// Tailwind 500/600 steps that land inside the dark-surface lightness band
// (OKLCH L 0.48–0.67) and were run through the dataviz palette validator
// against the card surface (#171717).
export const AXIS_COLOR = "#737373"; // neutral-500
export const GRID_COLOR = "#262626"; // neutral-800
export const SURFACE_COLOR = "#171717"; // neutral-900 — card background, used for 2px mark gaps
export const TOOLTIP_STYLE = { backgroundColor: "#171717", border: "1px solid #262626", borderRadius: 8 };
export const TOOLTIP_TEXT = { color: "#f5f5f5" };
export const REFERENCE_COLOR = "#a3a3a3"; // neutral-400 — reference lines stay neutral, not a series hue

export const SERIES = {
  fitness: "#0284c7", // sky-600
  fatigue: "#d946ef", // fuchsia-500
  form: "#0284c7",
  load: "#0284c7",
  easy: "#0284c7",
  long: "#8b5cf6", // violet-500 — paired with a distinct marker shape (CVD ΔE 7.5 warn band)
  trend: "#d4d4d4", // neutral-300
  adjusted: "#d97706", // amber-600
} as const;

// Low / moderate / high intensity (3-zone model). CVD warn band (ΔE 7.9), so
// the chart always carries a legend, tooltips and 2px surface gaps between stacks.
export const INTENSITY = {
  low: "#059669", // emerald-600
  moderate: "#d97706", // amber-600
  high: "#db2777", // pink-600
} as const;

export function formatDayTick(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "short" });
}

// Legend text stays in neutral ink — the swatch beside it carries identity.
export function legendLabel(value: string) {
  return <span style={{ color: "#a3a3a3" }}>{value}</span>;
}
