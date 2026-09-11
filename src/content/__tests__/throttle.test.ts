// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { throttle } from '../throttle.js';

/**
 * PBI 2026-09-11-07: the previous implementation was a last-call-wins
 * debounce whose "trailing" branch could never fire — continuous scroll
 * dropped updateMaxScroll calls (scroll-depth under-reporting into the
 * visit gate). These tests pin honest leading+trailing behavior.
 */
describe('throttle (PBI 2026-09-11-07)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires on the leading edge immediately', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const { fn: throttled } = throttle(fn, { delayMs: 100 });
    throttled('a');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('a');
  });

  it('fires a guaranteed trailing call with the latest args', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const { fn: throttled } = throttle(fn, { delayMs: 100 });
    throttled(1);
    throttled(2);
    throttled(3);
    // Leading call happened; trailing fires with the LATEST args after the window.
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith(3);
    vi.advanceTimersByTime(500);
    // No extra calls.
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('sustained calls keep ticking at the throttle interval (throttle, not debounce)', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const { fn: throttled } = throttle(fn, { delayMs: 100 });
    // A call every 50ms for 1s → leading + ~19 trailing ticks (not just one).
    for (let i = 0; i < 20; i++) {
      throttled(i);
      vi.advanceTimersByTime(100);
    }
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(10);
  });

  it('dispose cancels the pending trailing call', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const handle = throttle(fn, { delayMs: 100 });
    handle.fn(1);
    handle.fn(2); // arms trailing
    handle.dispose();
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1); // leading only
  });

  it('wires a single beforeunload flush, not one per throttle call', async () => {
    // Fresh module state: beforeUnloadWired is module-level.
    vi.resetModules();
    const { throttle: freshThrottle } = await import('../throttle.js');
    const listeners: EventListener[] = [];
    const originalAdd = window.addEventListener;
    vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, opts) => {
      if (type === 'beforeunload') listeners.push(listener as EventListener);
      return originalAdd.call(window, type, listener as EventListener, opts);
    });
    freshThrottle(vi.fn());
    freshThrottle(vi.fn());
    freshThrottle(vi.fn());
    expect(listeners.length).toBe(1);
    vi.restoreAllMocks();
  });
});
