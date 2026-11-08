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
  // PBI 2026-11-08-16: fail loud on nonsense inputs instead of propagating
  // NaN/Infinity/negative delays into sleep calls. Negative or NaN inputs
  // used to yield a negative or NaN delay (a sleep that resolves immediately
  // or never settles); Infinity used to wedge retry loops. Only maxMs may
  // be +Infinity (the documented "no cap" default).
  if (!Number.isFinite(attempt) || attempt < 0) {
    throw new RangeError(`backoffDelayMs: attempt must be a finite number >= 0 (got ${String(attempt)})`);
  }
  if (!Number.isFinite(baseMs) || baseMs < 0) {
    throw new RangeError(`backoffDelayMs: baseMs must be a finite number >= 0 (got ${String(baseMs)})`);
  }
  if (!Number.isFinite(multiplier) || multiplier < 0) {
    throw new RangeError(`backoffDelayMs: multiplier must be a finite number >= 0 (got ${String(multiplier)})`);
  }
  if ((!Number.isFinite(maxMs) && maxMs !== Number.POSITIVE_INFINITY) || maxMs < 0) {
    throw new RangeError(`backoffDelayMs: maxMs must be a finite number >= 0 or +Infinity (got ${String(maxMs)})`);
  }
  return Math.min(baseMs * Math.pow(multiplier, attempt), maxMs);
}
