"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { GarminSyncResult, GarminSyncStatus } from "@goalsplit/types";
import { API_URL } from "@/lib/api";

const POLL_INTERVAL_MS = 3000;

export function GarminSyncButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "syncing" | "done" | "error">("idle");
  const [result, setResult] = useState<GarminSyncResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  function pollStatus() {
    pollRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API_URL}/garmin/sync/status`);
        const json = (await res.json()) as { data: GarminSyncStatus };
        const status = json.data;

        if (status.state === "done") {
          setResult(status.result);
          setState("done");
          router.refresh();
        } else if (status.state === "error") {
          setErrorMsg(status.error ?? "Garmin sync failed");
          setState("error");
        } else {
          pollStatus();
        }
      } catch {
        // A transient network hiccup while polling shouldn't abandon the
        // sync — the job keeps running server-side regardless; just retry.
        pollStatus();
      }
    }, POLL_INTERVAL_MS);
  }

  async function handleSync() {
    setState("syncing");
    setResult(null);
    setErrorMsg(null);

    try {
      // This only kicks the sync off — it returns as soon as the job starts,
      // long before garmy itself finishes (a cold login + backfill can run
      // for several minutes, well past Railway's edge-proxy timeout).
      const res = await fetch(`${API_URL}/garmin/sync?days=14`, { method: "POST" });
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error ?? "Garmin sync failed");
      }

      pollStatus();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Garmin sync failed");
      setState("error");
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={handleSync}
        disabled={state === "syncing"}
        title="Pulls the last 14 days from Garmin via garmy — requires GARMIN_EMAIL/GARMIN_PASSWORD/GARMY_DB_PATH to be set."
        className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-500 hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state === "syncing" ? "Syncing..." : "Sync Garmin"}
      </button>

      {state === "done" && result && (
        <span className="text-xs text-emerald-400">
          {result.synced === 0 ? "No new days" : `+${result.synced} days synced`}
        </span>
      )}

      {state === "error" && <span className="text-xs text-red-400">{errorMsg}</span>}
    </div>
  );
}
