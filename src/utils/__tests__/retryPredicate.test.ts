/**
 * Unit: retryPredicate compat view of the shared transport table
 * (PBI 2026-10-06-15). The marker list is the SSOT
 * `LEGACY_TRANSPORT_MARKERS_FULL`; this file pins the connection check's
 * filtered view: kind first, TERMINAL exclusion, AbortError/timed-out special
 * case, then the shared markers. Sync only — no sleeps.
 */
import { describe, it, expect } from 'vitest';
import { isRetryableNetworkError } from '../retryPredicate.js';
import { createFailure, FailureKind, tagFailure } from '../failureTaxonomy.js';

describe('isRetryableNetworkError — kind first', () => {
  it('decides a tagged carrier by kind, not message', () => {
    const auth = tagFailure(
      new Error('request timeout / connection refused / offline mode'),
      createFailure(FailureKind.AUTH),
    );
    expect(isRetryableNetworkError(auth)).toBe(false);

    const network = tagFailure(new Error('boom'), createFailure(FailureKind.NETWORK));
    expect(isRetryableNetworkError(network)).toBe(true);
  });
});

describe('isRetryableNetworkError — TERMINAL exclusion stays', () => {
  it.each([
    'Invalid API key configured',
    'Blocked by CSP policy',
    'Invalid URL for endpoint',
    'Configuration error: port must be numeric',
    'Host contains invalid characters',
  ])('treats %s as terminal', (message) => {
    expect(isRetryableNetworkError(new Error(message))).toBe(false);
  });
});

describe('isRetryableNetworkError — AbortError/timed-out special case stays', () => {
  it('retries an AbortError', () => {
    const abort = new Error('The operation was aborted');
    abort.name = 'AbortError';
    expect(isRetryableNetworkError(abort)).toBe(true);
  });

  it('retries a timed-out message', () => {
    expect(isRetryableNetworkError(new Error('Request timed out after 30000ms'))).toBe(true);
  });
});

describe('isRetryableNetworkError — shared compat markers', () => {
  it.each([
    'Failed to fetch',
    'fetch failed',
    'Network request failed',
    'read ECONNRESET',
    'connect ECONNREFUSED 127.0.0.1',
    'connect ENETUNREACH 1.2.3.4',
  ])('retries %s', (message) => {
    expect(isRetryableNetworkError(new Error(message))).toBe(true);
  });

  it('reads the errno from the code property', () => {
    expect(isRetryableNetworkError({ name: 'Error', message: 'read failed', code: 'ECONNRESET' })).toBe(true);
  });

  it('matches pipeline-breadth words through the union (offline)', () => {
    expect(isRetryableNetworkError(new Error('offline mode'))).toBe(true);
  });

  it.each([
    'Failed for ai pipeline',
    'DuplicateError: already saved',
    'mystery failure',
  ])('does not retry %s', (message) => {
    expect(isRetryableNetworkError(new Error(message))).toBe(false);
  });
});
