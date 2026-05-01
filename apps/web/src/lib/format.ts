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
