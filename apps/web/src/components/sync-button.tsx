"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SyncResult } from "@goalsplit/types";
import { api, ApiError, errorMessage } from "@/lib/api";
import { describeSyncResult } from "@/lib/sync-messages";

export function SyncButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "syncing" | "backfilling">("idle");
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "warn" | "error" } | null>(null);

  async function handleSync(full: boolean) {
    setState(full ? "backfilling" : "syncing");
    setMessage(null);

    try {
      const data = await api.post<SyncResult>(`/activities/sync${full ? "?full=true" : ""}`);
      setMessage(describeSyncResult(data));
      router.refresh();
    } catch (err: unknown) {
      const text = errorMessage(err, "Sync failed");
      // A sync already running (e.g. the scheduled one) isn't an error.
      const tone = err instanceof ApiError && err.code === "SYNC_IN_PROGRESS" ? "warn" : "error";
      setMessage({ text, tone });
      if (err instanceof ApiError && err.code === "STRAVA_REAUTH_REQUIRED") router.refresh();
    } finally {
      setState("idle");
    }
  }

  const busy = state !== "idle";
  const toneClass = { ok: "text-emerald-400", warn: "text-amber-400", error: "text-red-400" };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => handleSync(false)}
        disabled={busy}
        className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-500 hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state === "syncing" ? "Syncing..." : "Sync Activities"}
      </button>

      <button
        type="button"
        onClick={() => handleSync(true)}
        disabled={busy}
        title="Walks your full Strava history and backfills rich detail (splits, effort, notes) and time-series streams (HR, pace, elevation) for activities that don't have them yet. May need a couple of clicks if you have a lot of history and hit Strava's rate limit."
        className="rounded-lg border border-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-500 transition-colors hover:border-neutral-600 hover:text-neutral-300 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state === "backfilling" ? "Backfilling..." : "Backfill History"}
      </button>

      {message && (
        <output className={`text-xs ${toneClass[message.tone]}`}>{message.text}</output>
      )}
    </div>
  );
}
