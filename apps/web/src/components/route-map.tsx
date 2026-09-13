"use client";

import dynamic from "next/dynamic";
import type { ActivityRoute } from "@goalsplit/types";

// next/dynamic(..., { ssr: false }) is only legal from inside a Client
// Component in the App Router — this wrapper exists solely to hold that
// boundary. The actual leaflet/react-leaflet imports (which touch `window` at
// import time) live in route-map-inner.tsx, loaded only on the client.
const RouteMapInner = dynamic(() => import("./route-map-inner").then((m) => m.RouteMapInner), {
  ssr: false,
  loading: () => <div className="h-[70vh] w-full animate-pulse rounded-lg bg-neutral-800" />,
});

interface RouteMapProps {
  routes: ActivityRoute[];
}

export function RouteMap({ routes }: Readonly<RouteMapProps>) {
  return <RouteMapInner routes={routes} />;
}
