import { RouteMap } from "@/components/route-map";
import { serverFetch } from "@/lib/api";
import type { RoutesResponse } from "@goalsplit/types";

const FALLBACK: RoutesResponse = { routes: [] };

export default async function RoutesPage() {
  const { routes } = await serverFetch<RoutesResponse>("/activities/routes", FALLBACK);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Routes</h1>
        <p className="mt-1 text-neutral-400">{routes.length} synced routes with GPS data</p>
      </div>

      {routes.length === 0 ? (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-10 text-center">
          <p className="text-sm text-neutral-500">No GPS-tracked activities synced yet.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 p-2">
          <RouteMap routes={routes} />
        </div>
      )}
    </div>
  );
}
