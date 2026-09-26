/**
 * retryPredicate.ts
 * Retry classification for the Obsidian connection check (obsidianClient).
 *
 * Deliberately separate from fetch.ts's defaultShouldRetry (fetchWithRetry):
 * that classifier is TransportError/Response-shape aware and method-aware,
 * while this one classifies opaque thrown errors from a raw fetch() by
 * string markers. If you change which network errors count as retryable,
 * check both tables — they intentionally disagree on details (e.g. this
 * one lowercases before matching 'failed to fetch') and must be updated
 * together when the intent is shared.
 */

const RETRYABLE_NETWORK_MARKERS = [
  'failed to fetch',
  'fetch failed',
  'network request failed',
  'networkerror',
  'connection reset',
  'connection refused',
  'connection closed',
  'econnreset',
  'econnrefused',
  'econnaborted',
  'enetunreach',
  'ehostunreach',
  'etimedout',
];

const TERMINAL_ERROR_MARKERS = [
  'api key',
  'blocked by csp',
  'csp blocked',
  'csp policy',
  'invalid url',
  'configuration',
  'protocol must',
  'port must',
  'host contains',
  'not allowed',
];

function getStringProperty(value: unknown, key: string): string {
  if (typeof value !== 'object' || value === null) {
    return '';
  }
  const property = (value as Record<string, unknown>)[key];
  return typeof property === 'string' ? property : '';
}

export function isRetryableNetworkError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const name = getStringProperty(error, 'name');
  const message = getStringProperty(error, 'message');
  const code = getStringProperty(error, 'code');
  const cause = (error as { cause?: unknown }).cause;
  const causeMessage = typeof cause === 'string'
    ? cause
    : typeof cause === 'object' && cause !== null
      ? `${getStringProperty(cause, 'name')} ${getStringProperty(cause, 'message')} ${getStringProperty(cause, 'code')}`
      : '';
  const text = `${name} ${message} ${code} ${causeMessage}`.toLowerCase();

  if (TERMINAL_ERROR_MARKERS.some((marker) => text.includes(marker))) {
    return false;
  }
  if (name === 'AbortError' || text.includes('timed out')) {
    return true;
  }
  return RETRYABLE_NETWORK_MARKERS.some((marker) => text.includes(marker));
}

export function isRetryableStatus(status: number, retryableStatusCodes: readonly number[]): boolean {
  return retryableStatusCodes.includes(status);
}

/**
 * Injection seam so retry tests do not have to spend real wall time sleeping.
 *
 * Consumed by `ObsidianClientOptions.sleep`, which is the single place a retry
 * wait is injected. `waitForRetry` deliberately takes no seam: adding one gave
 * the module a second, unreachable injection surface (nothing ever passed it),
 * which read as though tests injected at this level when they inject one layer
 * up.
 */
export type SleepFn = (ms: number) => Promise<void>;

export async function waitForRetry(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}
