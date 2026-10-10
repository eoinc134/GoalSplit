// Calendar arithmetic on local YYYY-MM-DD strings. Everything runs in UTC so
// the server's own timezone can never shift a date.

export function addDaysUtc(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromDateStr: string, toDateStr: string): number {
  const from = new Date(`${fromDateStr}T00:00:00Z`).getTime();
  const to = new Date(`${toDateStr}T00:00:00Z`).getTime();
  return Math.round((to - from) / 86_400_000);
}

// Monday of the date's week — matches Postgres date_trunc('week', ...).
export function weekStartOf(dateStr: string): string {
  const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDaysUtc(dateStr, -((dow + 6) % 7));
}
