// @layer 0 — Foundation: shared backoff delay computation
/**
 * Shared exponential-backoff delay computation.
 *
 * Concentrates the `min(base * multiplier^attempt, max)` formula previously
 * inlined across retry loops. Retry-or-not decisions stay in each domain;
 * only the delay arithmetic lives here.
 *
 * `attempt` is 0-origin: the first retry waits `baseMs`, the next
 * `baseMs * multiplier`, and so on. Callers holding a 1-origin counter pass
 * `attempt - 1` to preserve their legacy series.
 */
export interface BackoffOptions {
  /** First-attempt delay in ms. Defaults to 1000 (fetchWithRetry default). */
  baseMs?: number;
  /** Per-attempt multiplier. Use 1 for a constant delay (dashboardGateway). */
  multiplier?: number;
  /**
   * Upper bound in ms. Defaults to no cap so constant-delay callers cannot be
   * clamped by an invented ceiling; callers with a cap pass it explicitly.
   */
  maxMs?: number;
}

export function backoffDelayMs(attempt: number, opts: BackoffOptions = {}): number {
  const { baseMs = 1000, multiplier = 2, maxMs = Number.POSITIVE_INFINITY } = opts;
  return Math.min(baseMs * Math.pow(multiplier, attempt), maxMs);
}
