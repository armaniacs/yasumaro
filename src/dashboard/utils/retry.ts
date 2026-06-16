/**
 * retry.ts
 * Shared retry utility with exponential backoff for dashboard panels.
 * Used when the SQLite client in the Service Worker may not be ready yet
 * (Offscreen Document setup + WASM loading).
 */

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
  /** Optional label for console.warn logging. */
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
 * delay = min(baseDelay * 2^attempt, maxDelay) * (0.5 + Math.random() * 0.5)
 */
function sleepWithJitter(attempt: number, baseDelayMs: number, maxDelayMs: number): Promise<void> {
  const exponential = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
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
      console.warn(`[${opts.label}] attempt ${attempt + 1}/${opts.maxAttempts} failed:`, err);
    }
  }

  if (lastError !== undefined) {
    throw lastError;
  }
  return null;
}
