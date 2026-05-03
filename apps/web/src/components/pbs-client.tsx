"use client";

import { useState } from "react";
import type { PersonalBest, ApiResponse } from "@goalsplit/types";
import { formatTime, formatPace } from "@/lib/format";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";

// ── Helpers ──────────────────────────────────────────────────────────────────

function toTimeStr(seconds: number): string {
  if (!seconds) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function toSeconds(str: string): number {
  const parts = str.trim().split(":").map(Number);
  if (parts.some(isNaN) || parts.length === 0) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] ?? 0;
}

// Auto-calculate pace string from a time string + distance
function previewPace(timeStr: string, distanceKm: number): string {
  const secs = toSeconds(timeStr);
  if (!secs || !distanceKm) return "—";
  return formatPace(Math.round(secs / distanceKm));
}

// ── Edit state per row ───────────────────────────────────────────────────────

interface EditState {
  pbStr: string;     // current PB in H:MM:SS
  targetStr: string; // goal time in H:MM:SS
}

function pbToEdit(pb: PersonalBest): EditState {
  return {
    pbStr: toTimeStr(pb.time),
    targetStr: toTimeStr(pb.goalTime ?? 0),
  };
}

// ── Gap badge ────────────────────────────────────────────────────────────────

function GapBadge({ current, goal }: { current: number; goal: number }) {
  const diff = current - goal;
  if (diff <= 0) return <span className="text-xs font-medium text-emerald-400">Goal reached!</span>;
  return <span className="text-xs text-neutral-500">-{formatTime(diff)} to go</span>;
}

// ── Row ───────────────────────────────────────────────────────────────────────

function PbRow({
  pb,
  onSave,
}: {
  pb: PersonalBest;
  onSave: (id: string, patch: Partial<PersonalBest>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState<EditState>(() => pbToEdit(pb));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setEdit(pbToEdit(pb));
    setError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setError(null);
  }

  async function save() {
    const newTime = toSeconds(edit.pbStr);
    const newGoalTime = toSeconds(edit.targetStr);

    if (!newTime) { setError("Enter a valid current PB time"); return; }

    setSaving(true);
    setError(null);
    try {
      await onSave(pb.id, {
        time: newTime,
        pace: Math.round(newTime / pb.distance),
        goalTime: newGoalTime || undefined,
        goalPace: newGoalTime ? Math.round(newGoalTime / pb.distance) : undefined,
      });
      setEditing(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "w-28 rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm tabular-nums placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none";

  if (editing) {
    const pbPacePreview = previewPace(edit.pbStr, pb.distance);
    const targetPacePreview = previewPace(edit.targetStr, pb.distance);
    const targetSecs = toSeconds(edit.targetStr);
    const pbSecs = toSeconds(edit.pbStr);
    const gapSecs = pbSecs && targetSecs ? pbSecs - targetSecs : null;

    return (
      <>
        <tr className="bg-neutral-800/40">
          <td className="px-5 py-3 font-semibold">{pb.distanceLabel}</td>

          {/* Editable current PB */}
          <td className="px-5 py-3">
            <input
              type="text"
              value={edit.pbStr}
              onChange={(e) => setEdit((s) => ({ ...s, pbStr: e.target.value }))}
              placeholder="19:46"
              className={inputCls}
              autoFocus
            />
          </td>
          <td className="px-5 py-3 tabular-nums text-neutral-400 text-xs">{pbPacePreview}</td>

          {/* Editable target */}
          <td className="px-5 py-3">
            <input
              type="text"
              value={edit.targetStr}
              onChange={(e) => setEdit((s) => ({ ...s, targetStr: e.target.value }))}
              placeholder="19:00"
              className={inputCls}
            />
          </td>
          <td className="px-5 py-3 tabular-nums text-brand-400/70 text-xs">{targetPacePreview}</td>

          {/* Live gap preview */}
          <td className="px-5 py-3">
            {gapSecs !== null && targetSecs > 0 ? (
              <GapBadge current={pbSecs} goal={targetSecs} />
            ) : (
              <span className="text-xs text-neutral-600">—</span>
            )}
          </td>

          {/* Save / Cancel */}
          <td className="px-5 py-3">
            <div className="flex items-center gap-2">
              <button
                onClick={save}
                disabled={saving}
                className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50 transition-colors"
              >
                {saving ? "…" : "Save"}
              </button>
              <button
                onClick={cancelEdit}
                className="rounded-md border border-neutral-700 px-2.5 py-1 text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </td>
        </tr>

        {/* Inline error */}
        {error && (
          <tr className="bg-neutral-800/40">
            <td colSpan={7} className="px-5 pb-3 text-xs text-red-400">{error}</td>
          </tr>
        )}
      </>
    );
  }

  // ── Display row ─────────────────────────────────────────────────────────────
  return (
    <tr className="group hover:bg-neutral-800/30 transition-colors">
      <td className="px-5 py-4 font-semibold">{pb.distanceLabel}</td>
      <td className="px-5 py-4 tabular-nums">{formatTime(pb.time)}</td>
      <td className="px-5 py-4 tabular-nums text-neutral-400">{formatPace(pb.pace)}</td>
      <td className="px-5 py-4 tabular-nums text-brand-400">
        {pb.goalTime ? formatTime(pb.goalTime) : <span className="text-neutral-600">—</span>}
      </td>
      <td className="px-5 py-4 tabular-nums text-brand-400/70">
        {pb.goalPace ? formatPace(pb.goalPace) : <span className="text-neutral-600">—</span>}
      </td>
      <td className="px-5 py-4">
        {pb.goalTime ? <GapBadge current={pb.time} goal={pb.goalTime} /> : "—"}
      </td>
      <td className="px-5 py-4">
        <button
          onClick={startEdit}
          className="rounded px-2 py-1 text-xs text-neutral-600 opacity-0 transition-all group-hover:opacity-100 hover:text-neutral-300"
        >
          Edit
        </button>
      </td>
    </tr>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function PbsClient({ initialPbs }: { initialPbs: PersonalBest[] }) {
  const [pbs, setPbs] = useState<PersonalBest[]>(initialPbs);

  async function savePb(id: string, patch: Partial<PersonalBest>) {
    const res = await fetch(`${API}/pbs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json: ApiResponse<PersonalBest> = await res.json();
    if (!res.ok) throw new Error((json as unknown as { error: string }).error ?? "Save failed");
    setPbs((prev) => prev.map((pb) => (pb.id === id ? json.data : pb)));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Personal Bests</h1>
        <p className="mt-1 text-neutral-400">
          Hover a row and click <strong>Edit</strong> to update your PB or target time — paces
          calculate automatically.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-800 bg-neutral-800/50">
            <tr className="text-left text-xs text-neutral-500">
              <th className="px-5 py-3 font-medium">Distance</th>
              <th className="px-5 py-3 font-medium">Current PB</th>
              <th className="px-5 py-3 font-medium">Pace</th>
              <th className="px-5 py-3 font-medium text-brand-400">Target</th>
              <th className="px-5 py-3 font-medium text-brand-400">Target Pace</th>
              <th className="px-5 py-3 font-medium">Gap</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800/50">
            {pbs.map((pb) => (
              <PbRow key={pb.id} pb={pb} onSave={savePb} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
