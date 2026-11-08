// @vitest-environment jsdom
/**
 * throttle.monoclock.test.ts (review No.12)
 * Pins the single-source clock: a mid-life loss of performance.now() must
 * not flip the instance into the Date.now() epoch (which corrupted
 * `remaining` and fired spuriously). The instance stays on its creation
 * source and keeps throttling.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useTimerClock } from '../../../testDir/waitPolicy.js';
import { throttle } from '../throttle.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('throttle — single monotonic source (No.12)', () => {
  it('keeps throttling when performance.now disappears mid-life (no epoch flip)', () => {
    useTimerClock();
    const fn = vi.fn();
    const { fn: throttled, dispose } = throttle(fn, { delayMs: 100 });
    try {
      throttled('a');
      expect(fn).toHaveBeenCalledTimes(1);
      // Simulate the degraded context: performance vanishes after the
      // leading call pinned a performance-epoch lastCall.
      vi.stubGlobal('performance', undefined);
      throttled('b');
      // Single-source clock: still inside the window, so no synchronous
      // second call (the old epoch-mixing now() read Date.now() here and
      // fired the leading edge spuriously).
      expect(fn).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenLastCalledWith('b');
    } finally {
      dispose();
    }
  });

  it('keeps a Date-sourced instance on Date when performance appears later', () => {
    vi.stubGlobal('performance', undefined);
    useTimerClock();
    const fn = vi.fn();
    const { fn: throttled, dispose } = throttle(fn, { delayMs: 100 });
    try {
      throttled('a');
      expect(fn).toHaveBeenCalledTimes(1);
      // Performance (re)appears mid-life; the Date-sourced instance must
      // not jump epochs either.
      vi.unstubAllGlobals();
      throttled('b');
      expect(fn).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenLastCalledWith('b');
    } finally {
      dispose();
    }
  });
});
