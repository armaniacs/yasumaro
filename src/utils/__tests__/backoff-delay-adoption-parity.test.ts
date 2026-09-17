import { describe, it, expect } from 'vitest';
import { backoffDelayMs } from '../backoff.js';

/**
 * Parity pins for PBI 12 (backoff delay adoption).
 * Each series reproduces a pre-refactor inline formula verbatim; changing any
 * value here is a behavior change and must be a separate, deliberate commit.
 */
describe('backoffDelayMs adoption parity (PBI 12)', () => {
  it('reproduces the stepExecutor series (1000 * 2^retries, cap 5000; retries is 1-origin)', () => {
    const retries = [1, 2, 3, 4];
    const legacy = retries.map((r) => Math.min(Math.pow(2, r) * 1000, 5000));
    const delegated = retries.map((r) => backoffDelayMs(r, { baseMs: 1000, maxMs: 5000 }));
    expect(legacy).toEqual([2000, 4000, 5000, 5000]);
    expect(delegated).toEqual(legacy);
  });

  it('caps stepExecutor delays at maxMs for large retries', () => {
    for (const r of [5, 6, 10]) {
      expect(backoffDelayMs(r, { baseMs: 1000, maxMs: 5000 })).toBe(
        Math.min(Math.pow(2, r) * 1000, 5000),
      );
      expect(backoffDelayMs(r, { baseMs: 1000, maxMs: 5000 })).toBe(5000);
    }
  });

  it('reproduces the storageTransaction withLock series (initialDelay 100, uncapped)', () => {
    const attempts = [1, 2, 3, 4];
    const initialDelay = 100;
    const legacy = attempts.map((n) => initialDelay * Math.pow(2, n - 1));
    const delegated = attempts.map((n) => backoffDelayMs(n - 1, { baseMs: initialDelay }));
    expect(legacy).toEqual([100, 200, 400, 800]);
    expect(delegated).toEqual(legacy);
  });

  it('reproduces the storageTransaction withAtomic series (initialDelay 100, uncapped)', () => {
    const attempts = [1, 2, 3, 4];
    const initialDelay = 100;
    const legacy = attempts.map((n) => initialDelay * Math.pow(2, n - 1));
    const delegated = attempts.map((n) => backoffDelayMs(n - 1, { baseMs: initialDelay }));
    expect(legacy).toEqual([100, 200, 400, 800]);
    expect(delegated).toEqual(legacy);
  });

  it('reproduces the TrustDbKernel series (100 * 2^attempt, attempt is 0-origin, uncapped)', () => {
    const attempts = [0, 1, 2, 3];
    const legacy = attempts.map((a) => Math.pow(2, a) * 100);
    const delegated = attempts.map((a) => backoffDelayMs(a, { baseMs: 100 }));
    expect(legacy).toEqual([100, 200, 400, 800]);
    expect(delegated).toEqual(legacy);
  });

  it('reproduces the trancoUpdater series (baseDelay 1000, attempt is 1-origin, uncapped)', () => {
    const attempts = [1, 2, 3, 4];
    const baseDelay = 1000;
    const legacy = attempts.map((n) => baseDelay * Math.pow(2, n - 1));
    const delegated = attempts.map((n) => backoffDelayMs(n - 1, { baseMs: baseDelay }));
    expect(legacy).toEqual([1000, 2000, 4000, 8000]);
    expect(delegated).toEqual(legacy);
  });
});
