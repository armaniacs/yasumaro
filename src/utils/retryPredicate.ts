/**
 * retryPredicate.ts
 * Retry classification for the Obsidian connection check (obsidianClient).
 *
 * Structured failure kinds are authoritative here too
 * (src/utils/failureTaxonomy.ts is the SSOT): anything the transport or the
 * Obsidian boundary already classified is decided by `kind`. The transport
 * markers below are compatibility-only, for opaque thrown errors that carry no
 * `failure` metadata: the list itself is the SSOT
 * (`LEGACY_TRANSPORT_MARKERS_FULL` in `src/utils/failureTaxonomy.ts`) and this
 * alias is the connection check's filtered view (TERMINAL exclusion first,
 * then AbortError/timed-out special case, then the shared markers).
 * fetch.ts's `defaultShouldRetry` used to keep a third copy
 * of the same transport markers; it now calls `shouldRetryTransportFailure`, so
 * there is exactly one transport table and one HTTP-status table left.
 */

import {
  FailureKind,
  LEGACY_TRANSPORT_MARKERS_FULL,
  allowsImmediateRetry,
  canResendSameRequest,
  resolveFailure,
} from './failureTaxonomy.js';

/**
 * Compatibility only: the connection check's filtered view of the shared
 * transport table (see SSOT `LEGACY_TRANSPORT_MARKERS_FULL`). Reached only
 * for opaque errors without `failure` metadata, after the TERMINAL exclusion
 * below. It must never become a string a new boundary is asked to produce.
 */
const RETRYABLE_NETWORK_MARKERS: readonly string[] = LEGACY_TRANSPORT_MARKERS_FULL;

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
  // The connection check is a GET, so the safe-method rule never blocks it.
  const failure = resolveFailure(error);
  if (failure) {
    return failure.kind === FailureKind.NETWORK
      || failure.kind === FailureKind.TIMEOUT
      || (allowsImmediateRetry(failure.kind) && canResendSameRequest(failure.kind, 'GET'));
  }

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
