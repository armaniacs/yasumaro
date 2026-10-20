/**
 * retry.ts
 * Shared retry utility with exponential backoff for dashboard panels.
 * Used when the SQLite client in the Service Worker may not be ready yet
 * (Offscreen Document setup + WASM loading).
 */

import { logWarn } from '../../utils/logger/api.js';
import { ErrorCode } from '../../utils/logger/types.js';
import { errorMessage } from '../../utils/errorUtils.js';
// PBI 2026-10-20-21: the backoff arithmetic follows the shared formula in
// utils/backoff.ts — only the delay computation is delegated here; the
// jitter and the retry-or-not decision stay in this module.
import { backoffDelayMs } from '../../utils/backoff.js';

/**
 * Default configuration for retryWithExponentialBackoff.
 */
export interface RetryOptions {
  /** Maximum number of attempts (including the first). */
  maxAttempts?: number;
  /** Base delay in ms for the exponential backoff formula. */
  baseDelayMs?: number;
  /** Maximum delay in ms (cap). */
  maxDelayMs?: number;
  /** Optional label for the logWarn failure line. */
  label?: string;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 4,
  baseDelayMs: 500,
  maxDelayMs: 8000,
  label: 'retry',
};

/**
 * Sleep for a given duration with full jitter.
 * The exponential series comes from the shared backoffDelayMs (attempt is
 * 0-origin, multiplier 2); jitter halves it uniformly upward.
 */
function sleepWithJitter(attempt: number, baseDelayMs: number, maxDelayMs: number): Promise<void> {
  const exponential = backoffDelayMs(attempt, { baseMs: baseDelayMs, maxMs: maxDelayMs });
  const jitter = exponential * (0.5 + Math.random() * 0.5);
  return new Promise(resolve => setTimeout(resolve, jitter));
}

/**
 * Retry an async operation with exponential backoff and jitter.
 * The operation should return `null` or throw to indicate a retryable failure.
 * Returns the first non-null result, or throws after all attempts are exhausted.
 *
 * @example
 * const status = await retryWithExponentialBackoff(
 *   () => getSqliteStatus(),
 *   { label: 'getSqliteStatus', maxAttempts: 4 }
 * );
 */
export async function retryWithExponentialBackoff<T>(
  fn: () => Promise<T | null>,
  options: RetryOptions = {}
): Promise<T | null> {
  const opts: Required<RetryOptions> = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown = undefined;

  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    if (attempt > 0) {
      await sleepWithJitter(attempt - 1, opts.baseDelayMs, opts.maxDelayMs);
    }

    try {
      const result = await fn();
      if (result !== null) {
        return result;
      }
      lastError = undefined; // fn returned null, not an error
    } catch (err) {
      lastError = err;
      void logWarn(`[${opts.label}] attempt ${attempt + 1}/${opts.maxAttempts} failed`, { error: errorMessage(err) }, ErrorCode.UNKNOWN_ERROR, 'retry');
    }
  }

  if (lastError !== undefined) {
    throw lastError;
  }
  return null;
}
