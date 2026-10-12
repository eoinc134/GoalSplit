// Deterministic, uncorrelated pseudo-noise in [-amplitude, amplitude] (the
// classic fract(sin·43758) hash) so tests never flake. Not sin(i·k) alone —
// that's a smooth wave, which change-point detection rightly splits.
export function noise(i: number, amplitude: number): number {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * 2 * amplitude;
}
