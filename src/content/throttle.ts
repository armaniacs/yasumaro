/**
 * throttle.ts — leading + guaranteed-trailing throttle (PBI 2026-09-11-07).
 *
 * The previous implementation was a last-call-wins debounce mislabeled as a
 * throttle: its "trailing" branch re-tested the same threshold inside the
 * same frame and could never fire, so a continuous scroll dropped every
 * updateMaxScroll until 100ms of silence — under-reporting scroll depth into
 * the visit gate. This version fires on the leading edge and schedules one
 * guaranteed trailing call with the latest args.
 */

export interface ThrottleHandle<T extends (...args: unknown[]) => void> {
  /** The throttled function. */
  fn: T;
  /** Cancels the pending trailing call and removes the flush listener. */
  dispose: () => void;
}

/** Module-level registry of live instances — beforeunload flushes all of
 * them once (the old per-instance listener accumulated with every call). */
const liveInstances = new Set<() => void>();
let beforeUnloadWired = false;

function ensureBeforeUnloadFlush(): void {
  if (beforeUnloadWired || typeof window === 'undefined') return;
  beforeUnloadWired = true;
  window.addEventListener('beforeunload', () => {
    for (const flush of [...liveInstances]) {
      flush();
    }
    liveInstances.clear();
  });
}

export function throttle<T extends (...args: unknown[]) => void>(
  fn: T,
  options?: { delayMs?: number }
): ThrottleHandle<T> {
  const delayMs = options?.delayMs ?? 100;
  // -Infinity: the FIRST call always takes the leading edge, whatever the
  // clock reports (fake timers start performance.now() at 0).
  let lastCall = -Infinity;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;

  const invokeTrailing = (): void => {
    timerId = null;
    lastCall = performance.now();
    const args = lastArgs;
    lastArgs = null;
    if (args) fn(...args);
  };

  const flush = (): void => {
    if (timerId !== null) {
      clearTimeout(timerId);
      invokeTrailing();
    }
  };

  const throttledFn = ((...args: Parameters<T>) => {
    lastArgs = args;
    const now = performance.now();
    const remaining = lastCall + delayMs - now;
    if (remaining <= 0) {
      // Leading edge.
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      lastCall = now;
      lastArgs = null;
      fn(...args);
      return;
    }
    // Trailing edge: one guaranteed call with the latest args.
    if (timerId === null) {
      timerId = setTimeout(invokeTrailing, remaining);
    }
  }) as T;

  if (typeof window !== 'undefined') {
    ensureBeforeUnloadFlush();
    liveInstances.add(flush);
  }

  return {
    fn: throttledFn,
    dispose: () => {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      liveInstances.delete(flush);
    },
  };
}
