import Link from "next/link";

export function StreamsBackfillPrompt() {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 px-4 py-6 text-center text-sm text-neutral-500">
      No time-series data yet for activities in this window — click{" "}
      <Link href="/runs" className="text-brand-500 hover:text-brand-400 transition-colors">
        Backfill History
      </Link>{" "}
      on the Activities page to unlock this.
    </div>
  );
}
