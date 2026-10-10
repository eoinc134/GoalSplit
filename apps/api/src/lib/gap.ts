// Grade-adjusted pace via the Minetti et al. (2002) energy cost of running on
// gradients: C(i) in J/kg/m for gradient i (rise/run, not %). Valid across the
// measured range of ±45%, so grades are clamped to it. GAP credits each metre
// by C(i)/C(0) — a 10% climb counts as ~1.66 flat metres, a gentle descent as
// less than one. Strava's own GAP uses a different, HR-calibrated model that is
// flatter on descents, so the two won't match exactly.
const MAX_GRADE = 0.45;
const FLAT_COST = 3.6;

export function minettiCost(grade: number): number {
  const i = Math.max(-MAX_GRADE, Math.min(MAX_GRADE, grade));
  return 155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + FLAT_COST;
}

export function gapFactor(grade: number): number {
  return minettiCost(grade) / FLAT_COST;
}
