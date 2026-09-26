/**
 * The wait policy for this test suite: tests wait for a condition, never for a
 * duration. A fixed sleep cannot fail, so it carries no regression signal — it
 * only spends wall time, and on a loaded machine it is the difference between
 * green and flaky.
 *
 * See dev-docs/ADR/2026-09-26-test-suite-execution-time-contract.md
 */
import { vi } from 'vitest';

/**
 * Fakes the timer APIs and nothing else.
 *
 * `vi.useFakeTimers()` with the default `toFake` also replaces `setImmediate`
 * and `queueMicrotask`, which starves Vitest's module runner: a test that
 * awaits a dynamic import under a default fake clock hangs until the test
 * timeout. Narrowing the faked set keeps dynamic imports resolvable.
 */
const TIMER_APIS = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] as const;

/** Replaces the clock when a production timer is the subject of the test. */
export function useTimerClock(): void {
  vi.useFakeTimers({ toFake: [...TIMER_APIS] });
}

/**
 * Waits until `assertion` stops throwing. Returns as soon as the condition
 * holds, so the cost tracks the work rather than a guessed duration.
 */
export async function waitForMock(assertion: () => void, timeout = 1000): Promise<void> {
  await vi.waitFor(assertion, { interval: 1, timeout });
}

/**
 * Yields one macrotask turn. Use only to prove a *negative* on a path that
 * schedules no timer of its own, where there is no condition to wait for.
 */
export function drainMacrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
