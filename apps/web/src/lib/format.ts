export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = m.toString().padStart(2, "0");
  const ss = s.toString().padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export function formatPace(secondsPerKm: number): string {
  const m = Math.floor(secondsPerKm / 60);
  const s = secondsPerKm % 60;
  return `${m}:${s.toString().padStart(2, "0")}/km`;
}

export function goalProgress(current: number, target: number): number {
  if (target === 0) return 0;
  // For time goals lower is better — invert the ratio
  return Math.min(100, Math.round((target / current) * 100));
}

export function toTimeStr(seconds: number): string {
  if (!seconds) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function toSeconds(str: string): number {
  const parts = str.trim().split(":").map(Number);
  if (parts.some(isNaN) || parts.length === 0) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] ?? 0;
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
