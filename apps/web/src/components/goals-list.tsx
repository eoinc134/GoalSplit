import type { Goal, ApiResponse, GoalCategory } from "@goalsplit/types";
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

function GoalRow({ goal }: { goal: Goal }) {
  const isTime = goal.type === "time";
  const isCompletion = goal.type === "completion";
  const done = goal.status === "completed";

  return (
    <li
      className={[
        "flex items-center justify-between gap-3 py-2.5",
        done ? "opacity-50" : "",
      ].join(" ")}
    >
      <div className="flex min-w-0 items-center gap-2">
        {goal.prioritized && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
        )}
        {!goal.prioritized && <span className="h-1.5 w-1.5 shrink-0" />}
        <span className={["text-sm truncate", done ? "line-through text-neutral-500" : ""].join(" ")}>
          {goal.name}
        </span>
      </div>

      <span className="shrink-0 text-xs text-neutral-500">
        {done && "Done"}
        {!done && isTime && goal.currentValue > 0 && (
          <>
            {formatTime(goal.currentValue)}
            <span className="mx-1 text-neutral-700">/</span>
            {formatTime(goal.targetValue)}
          </>
        )}
        {!done && isCompletion && "—"}
      </span>
    </li>
  );
}

export async function GoalsList() {
  const goals = await fetchGoals();

  const prioritized = goals.filter((g) => g.prioritized && g.status !== "completed");
  const activeByCategory = goals.reduce<Partial<Record<GoalCategory, Goal[]>>>((acc, g) => {
    if (g.status === "active" && !g.prioritized) {
      (acc[g.category] ??= []).push(g);
    }
    return acc;
  }, {});
  const completedCount = goals.filter((g) => g.status === "completed").length;
  const activeCount = goals.filter((g) => g.status === "active").length;

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">Goals</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-neutral-500">{completedCount}/{goals.length} done</span>
          <a href="/goals" className="text-xs text-brand-500 hover:text-brand-400 transition-colors">
            View all
          </a>
        </div>
      </div>

      {goals.length === 0 && (
        <p className="text-sm text-neutral-500">No goals yet.</p>
      )}

      {prioritized.length > 0 && (
        <div className="mb-4">
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-neutral-500">
            Current focus
          </p>
          <ul className="divide-y divide-neutral-800/50">
            {prioritized.map((g) => <GoalRow key={g.id} goal={g} />)}
          </ul>
        </div>
      )}

      {Object.keys(activeByCategory).length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-neutral-500">
            {activeCount - prioritized.length} more active across{" "}
            {Object.keys(activeByCategory).length} categories
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {(Object.entries(activeByCategory) as [GoalCategory, Goal[]][]).map(([cat, gs]) => (
              <span
                key={cat}
                className="inline-flex items-center gap-1 rounded-full border border-neutral-700 px-2.5 py-0.5 text-xs text-neutral-400"
              >
                {GOAL_CATEGORY_META[cat].icon} {gs.length} {GOAL_CATEGORY_META[cat].label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
