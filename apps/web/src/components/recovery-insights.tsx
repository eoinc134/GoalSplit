import type { MeanWithCi, NextMorningGroup, Readiness } from "@goalsplit/types";
import { METHODS_URL } from "@/lib/constants";

function shortDate(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" });
}

function fmt(v: number, unit: string, digits: number): string {
  return `${v.toFixed(digits)}${unit ? ` ${unit}` : ""}`;
}

// A transparent readiness score: the number, and exactly what produced it.
export function ReadinessCard({ readiness }: Readonly<{ readiness: Readiness | null }>) {
  if (!readiness) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5 text-sm text-neutral-500">
        Readiness needs at least two of: resting HR, sleep, Body Battery and training form, each with a week or more of
        history to compare against.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-base font-semibold">Readiness · {shortDate(readiness.day)}</h2>
        <a href={`${METHODS_URL}#recovery`} className="text-xs text-neutral-500 transition-colors hover:text-neutral-300">
          How this is calculated →
        </a>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-4">
        <div>
          <p className="text-4xl font-bold tabular-nums">{readiness.score}</p>
          <p className="text-sm text-neutral-400">{readiness.label} · 50 is a typical day for you</p>
        </div>
        <ul className="grid flex-1 grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {readiness.components.map((c) => {
            const better = c.z > 0.25;
            const worse = c.z < -0.25;
            let verdict = "about usual";
            let icon = "•";
            if (better) {
              verdict = "better than usual";
              icon = "▲";
            } else if (worse) {
              verdict = "worse than usual";
              icon = "▼";
            }
            const digits = c.unit === "h" ? 1 : 0;
            return (
              <li key={c.key} className="flex items-baseline gap-2">
                <span aria-hidden className="w-3 text-neutral-500">
                  {icon}
                </span>
                <span className="text-neutral-200">{c.label}</span>
                <span className="tabular-nums text-neutral-400">
                  {fmt(c.value, c.unit, digits)} vs {fmt(c.baseline, c.unit, digits)}
                </span>
                <span className="text-xs text-neutral-500">{verdict}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

const GROUP_LABEL: Record<NextMorningGroup["group"], string> = {
  rest: "Rest day",
  easy: "Easy day",
  moderate: "Moderate day",
  hard: "Hard day",
};

function cell(m: MeanWithCi | null, digits: number, signed = false): string {
  if (!m) return "—";
  const s = (v: number) => `${signed && v > 0 ? "+" : ""}${v.toFixed(digits)}`;
  return `${s(m.mean)} (${s(m.ciLow)} to ${s(m.ciHigh)})`;
}

const TH = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-neutral-500";
const TD = "px-3 py-2 tabular-nums";

// How the next morning looks after each kind of day, from the athlete's own history.
export function NextMorningTable({ groups }: Readonly<{ groups: NextMorningGroup[] }>) {
  if (groups.length === 0) {
    return <p className="py-8 text-center text-sm text-neutral-500">Not enough overlapping training and Garmin history yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-neutral-800">
          <tr>
            <th className={TH}>After a…</th>
            <th className={TH}>TRIMP</th>
            <th className={TH} title="Next morning's resting HR minus your 28-day baseline, with 95% interval">
              Resting HR vs baseline
            </th>
            <th className={TH}>Sleep that night (h)</th>
            <th className={TH}>Next day&rsquo;s Body Battery peak</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800/60">
          {groups.map((g) => (
            <tr key={g.group} className="text-neutral-200">
              <td className="px-3 py-2">{GROUP_LABEL[g.group]}</td>
              <td className={`${TD} text-neutral-400`}>
                {g.group === "rest" ? "0" : `${Math.round(g.loadRange[0])}–${Math.round(g.loadRange[1])}`}
              </td>
              <td className={TD}>
                {cell(g.restingHrDeviation, 1, true)}
                {g.restingHrDeviation && <span className="ml-1 text-xs text-neutral-500">n={g.restingHrDeviation.n}</span>}
              </td>
              <td className={TD}>
                {cell(g.sleepHours, 1)}
                {g.sleepHours && <span className="ml-1 text-xs text-neutral-500">n={g.sleepHours.n}</span>}
              </td>
              <td className={TD}>
                {cell(g.bodyBatteryHigh, 0)}
                {g.bodyBatteryHigh && <span className="ml-1 text-xs text-neutral-500">n={g.bodyBatteryHigh.n}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
