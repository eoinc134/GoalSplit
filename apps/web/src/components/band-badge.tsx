import type { AcwrBand } from "@goalsplit/types";

const BAND_META: Record<AcwrBand, { label: string; icon: string; className: string }> = {
  undertraining: {
    label: "Undertraining",
    icon: "○",
    className: "text-neutral-400 border-neutral-700 bg-neutral-800/50",
  },
  "sweet-spot": {
    label: "Sweet spot",
    icon: "●",
    className: "text-emerald-400 border-emerald-700 bg-emerald-900/20",
  },
  caution: {
    label: "Caution",
    icon: "▲",
    className: "text-amber-400 border-amber-700 bg-amber-900/20",
  },
  "high-risk": {
    label: "High risk",
    icon: "▲",
    className: "text-red-400 border-red-800 bg-red-900/20",
  },
};

interface BandBadgeProps {
  band: AcwrBand | null;
}

export function BandBadge({ band }: Readonly<BandBadgeProps>) {
  if (!band) return null;
  const meta = BAND_META[band];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${meta.className}`}
    >
      <span aria-hidden>{meta.icon}</span>
      {meta.label}
    </span>
  );
}
