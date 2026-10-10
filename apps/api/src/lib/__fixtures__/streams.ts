// Synthetic Strava streams payloads (key_by_type=true shape) for tests.
export interface SyntheticStreamOptions {
  seconds: number; // duration, sampled at 1 Hz
  speedMs?: number | ((t: number) => number);
  hr?: number | ((t: number) => number) | null; // null = no heartrate stream
  gradePct?: number | ((t: number) => number) | null;
  tempC?: number | null;
  includeDistance?: boolean;
  moving?: (t: number) => boolean;
}

function at<T>(v: T | ((t: number) => T), t: number): T {
  return typeof v === "function" ? (v as (t: number) => T)(t) : v;
}

export function syntheticStreams(o: SyntheticStreamOptions): Record<string, { data: unknown[] }> {
  const time: number[] = [];
  const distance: number[] = [];
  const heartrate: number[] = [];
  const grade: number[] = [];
  const moving: boolean[] = [];
  let d = 0;
  for (let t = 0; t <= o.seconds; t++) {
    time.push(t);
    distance.push(d);
    if (o.hr != null) heartrate.push(at(o.hr, t));
    if (o.gradePct != null) grade.push(at(o.gradePct, t));
    const isMoving = o.moving ? o.moving(t) : true;
    moving.push(isMoving);
    if (isMoving) d += at(o.speedMs ?? 3, t);
  }

  const streams: Record<string, { data: unknown[] }> = { time: { data: time }, moving: { data: moving } };
  if (o.includeDistance !== false) streams.distance = { data: distance };
  if (o.hr != null) streams.heartrate = { data: heartrate };
  if (o.gradePct != null) streams.grade_smooth = { data: grade };
  if (o.tempC != null) streams.temp = { data: time.map(() => o.tempC) };
  return streams;
}
