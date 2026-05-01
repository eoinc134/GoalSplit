import type { Goal, GoalCategory, ApiResponse } from "@goalsplit/types";
import { GOAL_CATEGORY_META } from "@goalsplit/types";
import { formatTime } from "@/lib/format";

async function fetchGoals(): Promise<Goal[]> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";
  try {
    const res = await fetch(`${apiUrl}/goals`, { next: { revalidate: 0 } });
    const json: ApiResponse<Goal[]> = await res.json();
    return json.data;
  } catch {
    return [];
  }
}

const CATEGORY_ORDER: GoalCategory[] = ["running", "triathlon", "ultra", "adventure", "fitness"];

function GoalItem({ goal }: { goal: Goal }) {
  const done = goal.status === "completed";
  const isTime = goal.type === "time";

  return (
    <li className={["flex items-center justify-between gap-4 py-3", done ? "opacity-50" : ""].join(" ")}>
      <div className="flex min-w-0 items-center gap-3">
        {/* Status indicator */}
        <span
          className={[
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs",
            done
              ? "border-emerald-600 bg-emerald-900/30 text-emerald-400"
              : goal.prioritized
              ? "border-brand-500 bg-brand-900/30 text-brand-400"
              : "border-neutral-700 bg-neutral-800 text-neutral-500",
          ].join(" ")}
        >
          {done ? "✓" : goal.prioritized ? "★" : "○"}
        </span>

        <span className={["text-sm", done ? "line-through text-neutral-500" : ""].join(" ")}>
          {goal.name}
        </span>
      </div>

      {/* Right side: current → target for time goals */}
      {isTime && !done && goal.currentValue > 0 && (
        <span className="shrink-0 text-xs tabular-nums text-neutral-500">
          {formatTime(goal.currentValue)}
          <span className="mx-1.5 text-neutral-700">→</span>
          <span className="text-neutral-300">{formatTime(goal.targetValue)}</span>
        </span>
      )}
      {isTime && done && (
        <span className="shrink-0 text-xs tabular-nums text-emerald-500">
          {formatTime(goal.currentValue)}
        </span>
      )}
    </li>
  );
}

export default async function GoalsPage() {
  const goals = await fetchGoals();

  const byCategory = goals.reduce<Partial<Record<GoalCategory, Goal[]>>>((acc, g) => {
    (acc[g.category] ??= []).push(g);
    return acc;
  }, {});

  const totalDone = goals.filter((g) => g.status === "completed").length;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Goals</h1>
          <p className="mt-1 text-neutral-400">
            {totalDone} of {goals.length} completed
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-neutral-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-brand-500 text-brand-400 text-[10px]">★</span>
            Current focus
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-emerald-600 text-emerald-400 text-[10px]">✓</span>
            Completed
          </span>
        </div>
      </div>

      <div className="space-y-6">
        {CATEGORY_ORDER.filter((cat) => byCategory[cat]?.length).map((cat) => {
          const catGoals = byCategory[cat]!;
          const meta = GOAL_CATEGORY_META[cat];
          const doneCnt = catGoals.filter((g) => g.status === "completed").length;

          return (
            <div key={cat} className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
              <div className="mb-1 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <span>{meta.icon}</span>
                  {meta.label}
                </h2>
                <span className="text-xs text-neutral-500">{doneCnt}/{catGoals.length}</span>
              </div>
              <ul className="divide-y divide-neutral-800/50">
                {catGoals.map((g) => <GoalItem key={g.id} goal={g} />)}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
