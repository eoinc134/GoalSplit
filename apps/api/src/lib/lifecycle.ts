// Process lifecycle state shared by the health checks and the shutdown
// handler: once shutdown starts, /health/ready reports 503 so nothing new is
// routed here while in-flight requests finish.

let draining = false;

export function isDraining(): boolean {
  return draining;
}

export function startDraining(): void {
  draining = true;
}

// Test-only reset.
export function resetLifecycleForTests(): void {
  draining = false;
}
