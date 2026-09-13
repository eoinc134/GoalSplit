"use client";

import { MapContainer, TileLayer, Polyline, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { LatLngBoundsExpression } from "leaflet";
import type { ActivityRoute } from "@goalsplit/types";

// Same fixed hue-per-type palette as weekly-trends-chart.tsx's TYPE_COLOR, for
// visual consistency across the app. Unlisted types fall back to neutral.
const TYPE_COLOR: Record<string, string> = {
  Run: "#0ea5e9", // sky-500
  Ride: "#8b5cf6", // violet-500
  Swim: "#2dd4bf", // teal-400
  Walk: "#e879f9", // fuchsia-400
  Hike: "#e879f9", // fuchsia-400
};
const DEFAULT_COLOR = "#a3a3a3"; // neutral-400

interface RouteMapInnerProps {
  routes: ActivityRoute[];
}

// Only Polyline + Tooltip are used here, no Marker — so Leaflet's classic
// broken-default-icon-under-bundlers issue never comes up. It WOULD need the
// standard L.Icon.Default icon-URL fix if a start/end marker is added later.
export function RouteMapInner({ routes }: Readonly<RouteMapInnerProps>) {
  const bounds = routes.flatMap((r) => r.points) as LatLngBoundsExpression;

  return (
    <MapContainer
      bounds={bounds}
      boundsOptions={{ padding: [24, 24] }}
      style={{ height: "70vh", width: "100%" }}
      scrollWheelZoom
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      {routes.map((r) => (
        <Polyline
          key={r.activityId}
          positions={r.points}
          pathOptions={{ color: TYPE_COLOR[r.type] ?? DEFAULT_COLOR, weight: 3, opacity: 0.75 }}
        >
          <Tooltip sticky>
            {r.activityName} · {r.localDate}
          </Tooltip>
        </Polyline>
      ))}
    </MapContainer>
  );
}
