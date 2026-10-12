export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

export function now(): number {
  return Date.now();
}

/** Exponential backoff with jitter: base * 2^attempt + [0, base), capped at maxMs. */
export function backoffDelay(attempt: number, baseMs: number, maxMs = 10_000): number {
  const exponential = baseMs * 2 ** attempt;
  const jitter = Math.random() * baseMs;
  return Math.min(maxMs, exponential + jitter);
}
