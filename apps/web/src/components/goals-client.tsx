"use client";

import { useState } from "react";
import type { Goal, GoalCategory, GoalType, ApiResponse } from "@goalsplit/types";
import { GOAL_CATEGORY_META } from "@goalsplit/types";
import { formatTime, toTimeStr, toSeconds } from "@/lib/format";
import { API_URL as API } from "@/lib/api";

const CATEGORY_ORDER: GoalCategory[] = ["running", "triathlon", "ultra", "adventure", "fitness"];

const GOAL_TYPES: { value: GoalType; label: string }[] = [
  { value: "completion", label: "Completion (yes/no)" },
  { value: "time",       label: "Time" },
  { value: "distance",   label: "Distance" },
  { value: "pace",       label: "Pace" },
  { value: "frequency",  label: "Frequency" },
];

// ── Form state ────────────────────────────────────────────────────────────────

interface FormState {
  name: string;
  category: GoalCategory;
  type: GoalType;
  targetStr: string;
  currentStr: string;
  unit: string;
  targetDate: string;
  prioritized: boolean;
}

function goalToForm(goal?: Goal): FormState {
  if (!goal) {
    return { name: "", category: "running", type: "completion", targetStr: "", currentStr: "", unit: "", targetDate: "", prioritized: false };
  }
  const isTime = goal.type === "time" || goal.type === "pace";
  const isCompletion = goal.type === "completion";
  return {
    name: goal.name,
    category: goal.category,
    type: goal.type,
    targetStr: isCompletion ? "" : isTime ? toTimeStr(goal.targetValue) : String(goal.targetValue || ""),
    currentStr: isCompletion ? "" : isTime ? toTimeStr(goal.currentValue) : String(goal.currentValue || ""),
    unit: goal.unit,
    targetDate: goal.targetDate ?? "",
    prioritized: goal.prioritized ?? false,
  };
}

function formToPayload(form: FormState): Partial<Goal> {
  const isTime = form.type === "time" || form.type === "pace";
  const isCompletion = form.type === "completion";
  return {
    name: form.name,
    category: form.category,
    type: form.type,
    targetValue: isCompletion ? 1 : isTime ? toSeconds(form.targetStr) : parseFloat(form.targetStr) || 0,
    currentValue: isCompletion ? 0 : isTime ? toSeconds(form.currentStr) : parseFloat(form.currentStr) || 0,
    unit: isCompletion ? "completion" : isTime ? "seconds" : form.unit,
    targetDate: form.targetDate || undefined,
    prioritized: form.prioritized,
  };
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function GoalModal({ goal, onClose, onSave }: {
  goal?: Goal;
  onClose: () => void;
  onSave: (payload: Partial<Goal>, id?: string) => Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(() => goalToForm(goal));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isTime = form.type === "time" || form.type === "pace";
  const isCompletion = form.type === "completion";

  const setField =
    (key: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({
        ...f,
        [key]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value,
      }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Name is required"); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave(formToPayload(form), goal?.id);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-neutral-800 bg-neutral-950 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{goal ? "Edit Goal" : "Add Goal"}</h2>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-200 transition-colors text-lg leading-none">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="mb-1.5 block text-xs text-neutral-400">Name</label>
            <input
              type="text"
              value={form.name}
              onChange={setField("name")}
              placeholder="e.g. Sub 20 Minute 5K"
              className={inputCls}
              autoFocus
            />
          </div>

          {/* Category + Type */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs text-neutral-400">Category</label>
              <select value={form.category} onChange={setField("category")} className={inputCls}>
                {CATEGORY_ORDER.map((cat) => (
                  <option key={cat} value={cat}>
                    {GOAL_CATEGORY_META[cat].icon} {GOAL_CATEGORY_META[cat].label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-neutral-400">Type</label>
              <select
                value={form.type}
                onChange={(e) =>
                  setForm((f) => ({ ...f, type: e.target.value as GoalType, targetStr: "", currentStr: "" }))
                }
                className={inputCls}
              >
                {GOAL_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Target + Current */}
          {!isCompletion && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs text-neutral-400">
                  Target {isTime ? "(H:MM:SS)" : `(${form.unit || "value"})`}
                </label>
                <input
                  type="text"
                  value={form.targetStr}
                  onChange={setField("targetStr")}
                  placeholder={isTime ? "1:30:00" : "0"}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-neutral-400">
                  Current {isTime ? "(H:MM:SS)" : `(${form.unit || "value"})`}
                </label>
                <input
                  type="text"
                  value={form.currentStr}
                  onChange={setField("currentStr")}
                  placeholder={isTime ? "0:00" : "0"}
                  className={inputCls}
                />
              </div>
            </div>
          )}

          {/* Unit — only for non-time, non-completion */}
          {!isTime && !isCompletion && (
            <div>
              <label className="mb-1.5 block text-xs text-neutral-400">Unit</label>
              <input
                type="text"
                value={form.unit}
                onChange={setField("unit")}
                placeholder="e.g. km, runs/week, loops"
                className={inputCls}
              />
            </div>
          )}

          {/* Target date + In focus */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs text-neutral-400">Target Date (optional)</label>
              <input type="date" value={form.targetDate} onChange={setField("targetDate")} className={inputCls} />
            </div>
            <div className="flex items-end pb-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm select-none">
                <input
                  type="checkbox"
                  checked={form.prioritized}
                  onChange={setField("prioritized")}
                  className="h-4 w-4 rounded border-neutral-600 accent-red-500"
                />
                <span className="text-neutral-300">In focus</span>
              </label>
            </div>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-neutral-800 px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving…" : "Save Goal"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Goal row ──────────────────────────────────────────────────────────────────

function GoalRow({ goal, onEdit, onDelete, onTogglePrioritized, onToggleComplete }: {
  goal: Goal;
  onEdit: (goal: Goal) => void;
  onDelete: (id: string) => void;
  onTogglePrioritized: (goal: Goal) => void;
  onToggleComplete: (goal: Goal) => void;
}) {
  const done = goal.status === "completed";
  const isTime = goal.type === "time";

  return (
    <li className={["group flex items-center gap-3 py-3", done ? "opacity-60" : ""].join(" ")}>
      {/* Prioritize star */}
      <button
        onClick={() => onTogglePrioritized(goal)}
        title={goal.prioritized ? "Remove from focus" : "Add to focus"}
        className={[
          "shrink-0 text-base transition-colors",
          goal.prioritized ? "text-brand-500" : "text-neutral-700 hover:text-neutral-400",
        ].join(" ")}
      >
        ★
      </button>

      {/* Name + progress */}
      <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
        <span className={["truncate text-sm", done ? "line-through text-neutral-500" : ""].join(" ")}>
          {goal.name}
        </span>
        {isTime && goal.currentValue > 0 && !done && (
          <span className="shrink-0 tabular-nums text-xs text-neutral-500">
            {formatTime(goal.currentValue)}
            <span className="mx-1 text-neutral-700">→</span>
            {formatTime(goal.targetValue)}
          </span>
        )}
        {isTime && done && (
          <span className="shrink-0 tabular-nums text-xs text-emerald-500">
            {formatTime(goal.currentValue)}
          </span>
        )}
      </div>

      {/* Actions — visible on hover (always visible on mobile) */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 sm:opacity-100">
        <button
          onClick={() => onToggleComplete(goal)}
          title={done ? "Mark as active" : "Mark as complete"}
          className={[
            "rounded px-1.5 py-1 text-xs transition-colors",
            done ? "text-emerald-500 hover:text-neutral-400" : "text-neutral-600 hover:text-emerald-400",
          ].join(" ")}
        >
          {done ? "↺" : "✓"}
        </button>
        <button
          onClick={() => onEdit(goal)}
          title="Edit"
          className="rounded px-1.5 py-1 text-xs text-neutral-600 hover:text-neutral-300 transition-colors"
        >
          ✏
        </button>
        <button
          onClick={() => onDelete(goal.id)}
          title="Delete"
          className="rounded px-1.5 py-1 text-xs text-neutral-600 hover:text-red-400 transition-colors"
        >
          ✕
        </button>
      </div>
    </li>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function GoalsClient({ initialGoals }: { initialGoals: Goal[] }) {
  const [goals, setGoals] = useState<Goal[]>(initialGoals);
  const [modal, setModal] = useState<{ open: boolean; goal?: Goal }>({ open: false });
  const [pageError, setPageError] = useState<string | null>(null);

  const byCategory = goals.reduce<Partial<Record<GoalCategory, Goal[]>>>((acc, g) => {
    (acc[g.category] ??= []).push(g);
    return acc;
  }, {});

  const totalDone = goals.filter((g) => g.status === "completed").length;

  async function saveGoal(payload: Partial<Goal>, id?: string) {
    const res = await fetch(id ? `${API}/goals/${id}` : `${API}/goals`, {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json: ApiResponse<Goal> = await res.json();
    if (!res.ok) throw new Error((json as unknown as { error: string }).error ?? "Request failed");
    setGoals((prev) => id ? prev.map((g) => (g.id === id ? json.data : g)) : [...prev, json.data]);
  }

  async function deleteGoal(id: string) {
    if (!confirm("Delete this goal?")) return;
    const res = await fetch(`${API}/goals/${id}`, { method: "DELETE" });
    if (!res.ok) { setPageError("Failed to delete goal"); return; }
    setGoals((prev) => prev.filter((g) => g.id !== id));
  }

  async function togglePrioritized(goal: Goal) {
    const res = await fetch(`${API}/goals/${goal.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prioritized: !goal.prioritized }),
    });
    const { data }: ApiResponse<Goal> = await res.json();
    setGoals((prev) => prev.map((g) => (g.id === goal.id ? data : g)));
  }

  async function toggleComplete(goal: Goal) {
    const res = await fetch(`${API}/goals/${goal.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: goal.status === "completed" ? "active" : "completed" }),
    });
    const { data }: ApiResponse<Goal> = await res.json();
    setGoals((prev) => prev.map((g) => (g.id === goal.id ? data : g)));
  }

  return (
    <>
      {modal.open && (
        <GoalModal
          goal={modal.goal}
          onClose={() => setModal({ open: false })}
          onSave={saveGoal}
        />
      )}

      <div className="space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Goals</h1>
            <p className="mt-1 text-neutral-400">
              {totalDone} of {goals.length} completed
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-4 text-xs text-neutral-500">
              <span><span className="text-brand-500">★</span> In focus</span>
              <span><span className="text-emerald-400">✓</span> / ↺ Complete toggle</span>
              <span>✏ Edit &nbsp; ✕ Delete</span>
            </div>
            <button
              onClick={() => setModal({ open: true, goal: undefined })}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 transition-colors"
            >
              Add Goal
            </button>
          </div>
        </div>

        {pageError && <p className="text-sm text-red-400">{pageError}</p>}

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
                  {catGoals.map((g) => (
                    <GoalRow
                      key={g.id}
                      goal={g}
                      onEdit={(goal) => setModal({ open: true, goal })}
                      onDelete={deleteGoal}
                      onTogglePrioritized={togglePrioritized}
                      onToggleComplete={toggleComplete}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
