// Standard Google encoded-polyline decode, precision 5 (Strava's default).
// A truncated/malformed string can't infinite-loop: charCodeAt past the
// string end returns NaN, and NaN-based arithmetic/bitwise ops always fail
// the loop's continue-condition (`NaN >= 0x20` is false) — but it can yield
// nonsense coordinates, which is why isValidRoute is a separate check.
export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    lat += decodeSignedValue();
    lng += decodeSignedValue();
    points.push([lat / 1e5, lng / 1e5]);
  }

  return points;

  function decodeSignedValue(): number {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  }
}

// A single point can't render as a Polyline (only a marker, out of scope for
// this feature), so it's dropped rather than special-cased.
export const MIN_ROUTE_POINTS = 2;

export function isValidRoute(points: [number, number][]): boolean {
  if (points.length < MIN_ROUTE_POINTS) return false;
  return points.every(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180);
}

export interface RoutePolylineRow {
  activity_id: string;
  activity_name: string;
  type: string;
  local_date: string;
  summary_polyline: string | null;
}

export interface ActivityRouteLike {
  activityId: string;
  activityName: string;
  type: string;
  localDate: string;
  points: [number, number][];
}

export function buildActivityRoutes(rows: RoutePolylineRow[]): ActivityRouteLike[] {
  const routes: ActivityRouteLike[] = [];

  for (const row of rows) {
    if (!row.summary_polyline) continue;

    let points: [number, number][];
    try {
      points = decodePolyline(row.summary_polyline);
    } catch {
      continue; // cheap insurance — the decoder shouldn't throw, but never trust upstream data
    }

    if (!isValidRoute(points)) continue;

    routes.push({
      activityId: row.activity_id,
      activityName: row.activity_name,
      type: row.type,
      localDate: row.local_date,
      points,
    });
  }

  return routes;
}
