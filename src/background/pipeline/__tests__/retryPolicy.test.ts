import { describe, it, expect } from 'vitest';
import { RetryPolicy } from '../retryPolicy.js';

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
      expect(policy.isNetworkError(new Error(msg)), msg).toBe(true);
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
