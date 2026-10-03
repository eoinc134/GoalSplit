import Link from "next/link";
import type { ReactNode } from "react";

interface TeaserCardProps {
  href: string;
  label: string;
  value: string;
  subtext?: ReactNode;
}

// Same visual chrome as StatCard, plus a link affordance — used for cards that
// summarize a deeper page (Training/Recovery/Records) rather than a
// Dashboard-only aggregate, so "clickable" is visually distinct from "just a stat."
export function TeaserCard({ href, label, value, subtext }: Readonly<TeaserCardProps>) {
  return (
    <Link
      href={href}
      className="group block rounded-xl border border-neutral-800 bg-neutral-900 p-5 transition-colors hover:border-neutral-700"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">{label}</p>
        <span aria-hidden className="text-neutral-600 transition-colors group-hover:text-brand-400">
          →
        </span>
      </div>
      <p className="mt-2 text-3xl font-bold transition-colors group-hover:text-brand-400">{value}</p>
      {subtext && <div className="mt-1 text-sm text-neutral-400">{subtext}</div>}
    </Link>
  );
}
