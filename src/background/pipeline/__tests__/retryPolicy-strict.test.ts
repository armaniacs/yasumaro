/**
 * retryPolicy-strict.test.ts — PBI 2026-11-08-07(3).
 *
 * The legacy message scan matches whole words/phrases only: an unrelated
 * sentence that merely embeds a marker inside a longer word must not be
 * routed to the offline queue.
 */
import { describe, it, expect } from 'vitest';
import { RetryPolicy } from '../retryPolicy.js';

describe('RetryPolicy', () => {
  describe('matchesLegacyNetworkMarker strictness', () => {
    const policy = new RetryPolicy();

    it('rejects marker text embedded inside a longer word', () => {
      // Each message contains a legacy marker as a substring ("fetch failed",
      // "network", "connection") but never as a standalone word.
      expect(policy.isNetworkError(new Error('prefetch failed gracefully'))).toBe(false);
      expect(policy.isNetworkError(new Error('networked cache miss for ai pipeline'))).toBe(false);
      expect(policy.isNetworkError(new Error('the connectionpool was exhausted'))).toBe(false);
    });

    it('rejects sentences that only mention offline-adjacent words', () => {
      expect(policy.isNetworkError(new Error('DuplicateError: already saved'))).toBe(false);
      expect(policy.isNetworkError(new Error('user is offlineish, retry later'))).toBe(false);
    });

    it('still matches every enumerated standalone word or phrase', () => {
      for (const msg of [
        'request timeout',
        'service unavailable',
        'ECONNREFUSED 127.0.0.1',
        'read ECONNRESET',
        'connection refused',
        'fetch failed',
        'offline mode',
      ]) {
        expect(policy.isNetworkError(new Error(msg))).toBe(true);
      }
    });

    it('applies the strict match through the cause chain', () => {
      const wrapped = new Error('step failed', { cause: new Error('connection refused') });
      expect(policy.isNetworkError(wrapped)).toBe(true);
      const embedded = new Error('step failed', { cause: new Error('prefetch failed gracefully') });
      expect(policy.isNetworkError(embedded)).toBe(false);
    });

    it('terminates on a cyclic cause chain instead of recursing forever', () => {
      const cyclic = new Error('nothing matching here') as Error & { cause: unknown };
      cyclic.cause = cyclic;
      expect(policy.isNetworkError(cyclic)).toBe(false);
    });

    it('shouldEnqueueForOffline follows the same strict scan', () => {
      expect(policy.shouldEnqueueForOffline(new Error('prefetch failed gracefully'))).toBe(false);
      expect(policy.shouldEnqueueForOffline(new Error('service unavailable'))).toBe(true);
    });
  });
});
