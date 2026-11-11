import type { SyncStatus } from "@goalsplit/types";
import { load } from "@/lib/server-api";
import { NOT_CONNECTED } from "@/lib/fallbacks";

export async function StravaConnect() {
  const { data: status, error } = await load<SyncStatus>("/auth/status", NOT_CONNECTED);
  // Unknown is not "not connected": don't offer a Connect button on a failed check.
  if (error) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5 text-sm text-neutral-400">
        <span className="font-medium text-neutral-200">Strava</span> — couldn&rsquo;t check the connection: {error.message}
      </div>
    );
  }
  const needsReconnect = status.isConnected && status.needsReconnect;

  return (
    <div
      className={[
        "rounded-xl border bg-neutral-900 p-5",
        needsReconnect ? "border-amber-700" : "border-neutral-800",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {/* Strava orange dot */}
          <span
            className={[
              "flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold",
              status.isConnected && !needsReconnect
                ? "bg-orange-500 text-white"
                : "bg-neutral-800 text-neutral-500",
            ].join(" ")}
          >
            S
          </span>
          <div>
            <p className="text-sm font-medium">
              {status.isConnected && status.athlete
                ? `${status.athlete.firstname} ${status.athlete.lastname}`
                : "Strava"}
            </p>
            <p className={`text-xs ${needsReconnect ? "text-amber-400" : "text-neutral-500"}`}>
              {needsReconnect
                ? "Strava access was revoked or expired — syncing is paused"
                : status.isConnected
                  ? "Connected"
                  : "Not connected"}
            </p>
          </div>
        </div>

        {status.isConnected && !needsReconnect ? (
          <span className="text-xs text-neutral-500">Connected</span>
        ) : (
          // Plain <a>: a route handler redirecting to Strava, not a page (see login/page.tsx).
          // eslint-disable-next-line @next/next/no-html-link-for-pages
          <a
            href="/api/auth/strava"
            className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-400 transition-colors"
          >
            {needsReconnect ? "Reconnect Strava" : "Connect Strava"}
          </a>
        )}
      </div>
    </div>
  );
}
