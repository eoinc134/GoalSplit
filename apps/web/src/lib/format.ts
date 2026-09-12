export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = m.toString().padStart(2, "0");
  const ss = s.toString().padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

// Parses "M:SS" or "H:MM:SS" into whole seconds; null if not a valid time.
export function toSeconds(input: string): number | null {
  const parts = input.trim().split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  const [h, m, s] = parts.length === 3 ? nums : [0, nums[0], nums[1]];
  if (m >= 60 || s >= 60) return null;
  return h * 3600 + m * 60 + s;
}

export function formatPace(secondsPerKm: number): string {
  const m = Math.floor(secondsPerKm / 60);
  const s = secondsPerKm % 60;
  return `${m}:${s.toString().padStart(2, "0")}/km`;
}

export function formatDate(iso: string, includeWeekday = false): string {
  return new Date(iso).toLocaleDateString("en-IE", {
    ...(includeWeekday && { weekday: "short" }),
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function paceFromSpeed(speedMs: number): string {
  if (!speedMs) return "—";
  return formatPace(Math.round(1000 / speedMs));
}
