"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

// Runs a Garmin sync on demand and shows the outcome — including the real
// reason when it fails (key missing, expired, or Garmin refusing the request),
// which a background sync can only write to the server log.
export function GarminSyncButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "syncing">("idle");
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  async function sync() {
    setState("syncing");
    setMessage(null);
    try {
      const { data } = await api.post<{ data: { synced: number; start: string; end: string } }>("/garmin/sync", {});
      setMessage({ text: `Synced ${data.synced} days (${data.start} to ${data.end})`, ok: true });
      router.refresh();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Garmin sync failed", ok: false });
    } finally {
      setState("idle");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={sync}
        disabled={state === "syncing"}
        className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm transition-colors hover:border-neutral-500 disabled:opacity-50"
      >
        {state === "syncing" ? "Syncing…" : "Sync Garmin"}
      </button>
      {message && (
        <p role="status" className={`max-w-xs text-right text-xs ${message.ok ? "text-neutral-400" : "text-red-400"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
