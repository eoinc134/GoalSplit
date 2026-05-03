import type { SyncStatus } from "@goalsplit/types";
import { serverFetch, API_URL } from "@/lib/api";

export async function StravaConnect() {
  const status = await serverFetch<SyncStatus>("/auth/status", { isConnected: false });
  const apiUrl = API_URL;

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {/* Strava orange dot */}
          <span
            className={[
              "flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold",
              status.isConnected
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
            <p className="text-xs text-neutral-500">
              {status.isConnected ? "Connected" : "Not connected"}
            </p>
          </div>
        </div>

        {status.isConnected ? (
          <form action={`${apiUrl}/auth/strava`} method="GET">
            {/* Disconnect is a DELETE — we'll use a client component for that later */}
            <span className="text-xs text-neutral-500">Connected</span>
          </form>
        ) : (
          <a
            href={`${apiUrl}/auth/strava`}
            className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-400 transition-colors"
          >
            Connect Strava
          </a>
        )}
      </div>
    </div>
  );
}
