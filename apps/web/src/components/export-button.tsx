"use client";

import { useState } from "react";
import { API_URL } from "@/lib/api";

const DAY_OPTIONS = [7, 30, 90];

export function ExportButton() {
  const [days, setDays] = useState(30);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  async function handleCopy() {
    try {
      const res = await fetch(`${API_URL}/activities/export?days=${days}`);
      const json = await res.json();
      await navigator.clipboard.writeText(json.data.markdown);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    } finally {
      setTimeout(() => setCopyState("idle"), 2000);
    }
  }

  function handleDownload() {
    window.location.href = `${API_URL}/activities/export?days=${days}&format=markdown`;
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={days}
        onChange={(e) => setDays(Number(e.target.value))}
        aria-label="Export window"
        className="rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-300"
      >
        {DAY_OPTIONS.map((d) => (
          <option key={d} value={d}>
            Last {d}d
          </option>
        ))}
      </select>
      <button
        onClick={handleCopy}
        className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-500 hover:text-neutral-100"
      >
        {copyState === "copied" ? "Copied!" : copyState === "error" ? "Copy failed" : "Copy for Claude"}
      </button>
      <button
        onClick={handleDownload}
        className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-500 hover:text-neutral-100"
      >
        Download .md
      </button>
    </div>
  );
}
