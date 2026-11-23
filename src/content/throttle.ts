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

/**
 * Review No.12: single monotonic time source per throttle instance. The old
 * now() mixed epochs — performance.now() (ms since page load, small) when
 * available and Date.now() (unix epoch, huge) otherwise — so a source flip
 * mid-life corrupted `remaining` (a performance-epoch lastCall against a
 * Date-epoch now always reads as long-past-due and fires spuriously, and
 * the reverse stalls the trailing edge). The source is probed once at
 * creation and the instance never leaves it: a performance instance that
 * later throws or turns non-finite reuses its last good reading instead of
 * falling back to Date.now(), so lastCall and nowMs always share an epoch
 * (the "fallback retakes lastCall in the same source" requirement holds by
 * construction — there is no second source to retake from).
 */
function createMonotonicClock(): () => number {
  let usePerformance = false;
  try {
    usePerformance =
      typeof performance !== 'undefined' &&
      typeof performance.now === 'function' &&
      Number.isFinite(performance.now());
  } catch {
    usePerformance = false;
  }
  if (usePerformance) {
    let lastGood = 0;
    let initialized = false;
    return () => {
      try {
        const t = performance.now();
        if (typeof t === 'number' && Number.isFinite(t)) {
          lastGood = t;
          initialized = true;
          return t;
        }
      } catch {
        // Performance degraded mid-life: stay on the same source by
        // reusing the last good reading instead of mixing in Date.now().
      }
      return initialized ? lastGood : 0;
    };
  }
  return () => Date.now();
}

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
  const now = createMonotonicClock();
  // -Infinity: the FIRST call always takes the leading edge, whatever the
  // clock reports (fake timers start performance.now() at 0).
  let lastCall = -Infinity;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;

  const invokeTrailing = (): void => {
    timerId = null;
    lastCall = now();
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
    const nowMs = now();
    const remaining = lastCall + delayMs - nowMs;
    if (remaining <= 0) {
      // Leading edge.
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      lastCall = nowMs;
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
