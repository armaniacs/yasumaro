import { describe, it, expect } from 'vitest';
import { RetryPolicy } from '../retryPolicy.js';
import { tagFailure, createFailure, type FailureKindValue } from '../../../utils/failureTaxonomy.js';

describe('RetryPolicy.isNetworkError — ADR 2026-08-27 enumeration', () => {
  const policy = new RetryPolicy();

  it('matches ADR enumeration words', () => {
    for (const msg of [
      'network error',
      'fetch failed',
      'request timeout',
      'offline mode',
      'ECONNREFUSED 127.0.0.1',
      'getaddrinfo ENOTFOUND api.example.com',
      'connection refused',
      'service unavailable',
    ]) {
      expect(policy.isNetworkError(new Error(msg))).toBe(true);
    }
  });

  it("does NOT match unrelated failures containing 'ai ' (false positive fix)", () => {
    expect(policy.isNetworkError(new Error('Failed for ai pipeline'))).toBe(false);
    expect(policy.isNetworkError(new Error('ai summary step threw'))).toBe(false);
  });

  it('returns false for non-network errors', () => {
    expect(policy.isNetworkError(new Error('DuplicateError: already saved'))).toBe(false);
    expect(policy.isNetworkError(null)).toBe(false);
    expect(policy.isNetworkError(undefined)).toBe(false);
  });

  it('recurses into error.cause', () => {
    const wrapped = new Error('step failed', { cause: new Error('fetch failed') });
    expect(policy.isNetworkError(wrapped)).toBe(true);
  });

  it('shouldEnqueueForOffline mirrors isNetworkError', () => {
    expect(policy.shouldEnqueueForOffline(new Error('timeout'))).toBe(true);
    expect(policy.shouldEnqueueForOffline(new Error('Failed for ai pipeline'))).toBe(false);
  });
});

describe('RetryPolicy — structured failure kinds are the contract (PBI 2026-09-25-11)', () => {
  const policy = new RetryPolicy();

  it.each([
    ['network', true],
    ['timeout', true],
    ['http', false],
    ['auth', false],
    ['rate_limit', false],
    ['configuration', false],
    ['csp', false],
  ])('routes a %s carrier to offline recovery = %s', (kind, expected) => {
    const carrier = tagFailure(
      // A message that the legacy substring scan would read as "connection"
      // (i.e. offline eligible) for every one of these kinds.
      new Error('Error: Failed to connect to Obsidian. Please check your settings and connection.'),
      createFailure(kind as FailureKindValue),
    );

    expect(policy.shouldEnqueueForOffline(carrier)).toBe(expected);
    expect(policy.isNetworkError(carrier)).toBe(expected);
  });

  it('overrides the legacy message scan when a kind is present', () => {
    // 'timed out' and 'connection refused' used to be the only signals. With a
    // structured kind they are no longer consulted at all.
    const authWithNetworkishText = tagFailure(
      new Error('request timeout / connection refused / offline mode'),
      createFailure('auth'),
    );
    expect(policy.shouldEnqueueForOffline(authWithNetworkishText)).toBe(false);
  });

  it('reads a result-summary carrier through the same normalization', () => {
    expect(policy.shouldEnqueueForOffline({ failure: { kind: 'timeout' } })).toBe(true);
    expect(policy.shouldEnqueueForOffline({ failure: { kind: 'rate_limit' } })).toBe(false);
  });

  it('falls back to the legacy scan only for untagged inputs', () => {
    expect(policy.shouldEnqueueForOffline(new Error('connection refused'))).toBe(true);
    expect(policy.shouldEnqueueForOffline(new Error('Failed for ai pipeline'))).toBe(false);
  });
});
