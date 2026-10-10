export function mean(values: number[]): number | null {
  return values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : null;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function standardDeviation(values: number[]): number | null {
  const m = mean(values);
  if (m === null) return null;
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length);
}

// Solves A·x = b by Gaussian elimination with partial pivoting; null if singular.
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

// Ordinary least squares with an intercept. `xs` rows are the predictors
// (without the leading 1). Returns coefficients [b0, b1, ...] and R².
export function ols(xs: number[][], ys: number[]): { coefficients: number[]; r2: number } | null {
  if (xs.length !== ys.length || xs.length === 0) return null;
  const rows = xs.map((x) => [1, ...x]);
  const k = rows[0].length;
  if (rows.length <= k) return null;

  const xtx = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => rows.reduce((s, r) => s + r[i] * r[j], 0)));
  const xty = Array.from({ length: k }, (_, i) => rows.reduce((s, r, idx) => s + r[i] * ys[idx], 0));
  const coefficients = solve(xtx, xty);
  if (!coefficients) return null;

  const yMean = mean(ys)!;
  const ssTot = ys.reduce((s, y) => s + (y - yMean) ** 2, 0);
  const ssRes = rows.reduce((s, r, idx) => s + (ys[idx] - r.reduce((acc, v, j) => acc + v * coefficients[j], 0)) ** 2, 0);
  return { coefficients, r2: ssTot > 0 ? 1 - ssRes / ssTot : 0 };
}
