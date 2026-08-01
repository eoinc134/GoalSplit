"use client";

import { useState } from "react";
import type { SyncResult } from "@goalsplit/types";

export function SyncButton() {
  const [state, setState] = useState<"idle" | "syncing" | "backfilling" | "done" | "error">("idle");
  const [result, setResult] = useState<SyncResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSync(full: boolean) {
    setState(full ? "backfilling" : "syncing");
    setResult(null);
    setErrorMsg(null);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";
      const res = await fetch(`${apiUrl}/activities/sync${full ? "?full=true" : ""}`, {
        method: "POST",
      });
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error ?? "Sync failed");
      }

      setResult(json.data as SyncResult);
      setState("done");
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Sync failed");
      setState("error");
    }
  }

  const busy = state === "syncing" || state === "backfilling";

  return (
    <div className="flex items-center gap-3">
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
        title="Walks your full Strava history and backfills rich detail (splits, effort, notes) for activities that don't have it yet. May need a couple of clicks if you have a lot of history and hit Strava's rate limit."
        className="rounded-lg border border-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-500 transition-colors hover:border-neutral-600 hover:text-neutral-300 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state === "backfilling" ? "Backfilling..." : "Backfill History"}
      </button>

      {state === "done" && result && (
        <span className="text-xs text-emerald-400">
          {result.synced === 0 ? "Already up to date" : `+${result.synced} activities synced`}
        </span>
      )}

      {state === "error" && <span className="text-xs text-red-400">{errorMsg}</span>}
    </div>
  );
}
