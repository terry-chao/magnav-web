/** Server-clock estimate using the lowest-RTT ping sample of the last minute. */

let offsetMs = 0;
let bestRtt = Number.POSITIVE_INFINITY;
let lastReset = performance.now();

export function observePong(t0: number, t1: number, serverTime: number): void {
  const rtt = Math.max(0, t1 - t0);
  const offset = serverTime - (t0 + t1) / 2;
  // accept a sample if it is at least as good as the current best, with a
  // small tolerance; decay old samples every 60 s
  if (performance.now() - lastReset > 60_000) {
    bestRtt = Number.POSITIVE_INFINITY;
    lastReset = performance.now();
  }
  if (rtt <= bestRtt + 8) {
    bestRtt = Math.min(bestRtt, rtt);
    offsetMs = offsetMs * 0.6 + offset * 0.4;
  }
}

export function serverNow(): number {
  return Date.now() + offsetMs;
}

export function clockRtt(): number {
  return Number.isFinite(bestRtt) ? bestRtt : 0;
}

export function resetClock(): void {
  offsetMs = 0;
  bestRtt = Number.POSITIVE_INFINITY;
  lastReset = performance.now();
}
