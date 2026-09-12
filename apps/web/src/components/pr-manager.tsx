"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ManualPrEntry } from "@goalsplit/types";
import { api } from "@/lib/api";
import { formatTime, formatDate, toSeconds } from "@/lib/format";
import { PR_DISTANCE_LADDER } from "@/lib/constants";
import type { ActivityRow } from "@/lib/types";

interface PrManagerProps {
  initialManualEntries: ManualPrEntry[];
  activities: ActivityRow[];
}

type FormState = "idle" | "submitting" | "error";

export function PrManager({ initialManualEntries, activities }: Readonly<PrManagerProps>) {
  const router = useRouter();
  const [entries, setEntries] = useState(initialManualEntries);
  const [distanceLabel, setDistanceLabel] = useState("");
  const [time, setTime] = useState("");
  const [achievedDate, setAchievedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [sourceActivityId, setSourceActivityId] = useState("");
  const [formState, setFormState] = useState<FormState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const timeSeconds = toSeconds(time);
    if (timeSeconds === null) {
      setError('Time must be "M:SS" or "H:MM:SS", e.g. 19:58 or 3:32:10');
      return;
    }
    if (!distanceLabel.trim()) {
      setError("Distance is required");
      return;
    }
    if (!achievedDate) {
      setError("Date is required");
      return;
    }

    setFormState("submitting");
    try {
      const created = await api.post<ManualPrEntry>("/prs", {
        distanceLabel: distanceLabel.trim(),
        timeSeconds,
        achievedDate,
        notes: notes.trim() || undefined,
        sourceActivityId: sourceActivityId || undefined,
      });
      setEntries((prev) => [created, ...prev]);
      setDistanceLabel("");
      setTime("");
      setAchievedDate("");
      setNotes("");
      setSourceActivityId("");
      setFormState("idle");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add PR");
      setFormState("error");
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await api.delete(`/prs/${id}`);
      setEntries((prev) => prev.filter((e) => e.id !== id));
      router.refresh();
    } catch {
      // leave the entry in place — the user can retry
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-4 text-base font-semibold">Add a PR</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="pr-distance" className="mb-1 block text-xs text-neutral-500">Distance</label>
            <input
              id="pr-distance"
              list="pr-distance-ladder"
              value={distanceLabel}
              onChange={(e) => setDistanceLabel(e.target.value)}
              placeholder="10K"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm"
            />
            <datalist id="pr-distance-ladder">
              {PR_DISTANCE_LADDER.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </div>

          <div>
            <label htmlFor="pr-time" className="mb-1 block text-xs text-neutral-500">Time</label>
            <input
              id="pr-time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              placeholder="19:58"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm"
            />
          </div>

          <div>
            <label htmlFor="pr-date" className="mb-1 block text-xs text-neutral-500">Date</label>
            <input
              id="pr-date"
              type="date"
              value={achievedDate}
              onChange={(e) => setAchievedDate(e.target.value)}
              max={new Date().toISOString().slice(0, 10)}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm"
            />
          </div>

          <div>
            <label htmlFor="pr-activity" className="mb-1 block text-xs text-neutral-500">
              Link an activity (optional)
            </label>
            <select
              id="pr-activity"
              value={sourceActivityId}
              onChange={(e) => setSourceActivityId(e.target.value)}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm"
            >
              <option value="">None</option>
              {activities.map((a) => (
                <option key={a.id} value={a.id}>
                  {formatDate(a.start_date_local)} — {a.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3">
          <label htmlFor="pr-notes" className="mb-1 block text-xs text-neutral-500">Notes (optional)</label>
          <input
            id="pr-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. GPS recorded this run short at 9.9K"
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm"
          />
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="submit"
            disabled={formState === "submitting"}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {formState === "submitting" ? "Adding..." : "Add PR"}
          </button>
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>
      </form>

      {entries.length > 0 && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <h2 className="mb-4 text-base font-semibold">Manual entries</h2>
          <ul className="divide-y divide-neutral-800/50">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {entry.distanceLabel} — {formatTime(entry.timeSeconds)}
                  </p>
                  <p className="truncate text-xs text-neutral-500">
                    {formatDate(entry.achievedDate)}
                    {entry.sourceActivityName && ` · from ${entry.sourceActivityName}`}
                    {entry.notes && ` · ${entry.notes}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(entry.id)}
                  disabled={deletingId === entry.id}
                  className="shrink-0 rounded-lg border border-neutral-800 px-3 py-1.5 text-xs text-neutral-500 transition-colors hover:border-red-800 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {deletingId === entry.id ? "Removing..." : "Remove"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
