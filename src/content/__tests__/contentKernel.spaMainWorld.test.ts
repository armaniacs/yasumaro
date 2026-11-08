// @vitest-environment jsdom
/**
 * contentKernel.spaMainWorld.test.ts (review No.1/No.2)
 * - No.2: same-URL (shallow) pushState/replaceState never resets the visit.
 * - No.1: isolated-world wrapping is documented as MAIN-blind; the
 *   MAIN-world backing is URL polling (pollSpaUrlOnce/startSpaUrlPolling),
 *   which detects transitions the wrappers cannot see.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ContentKernel } from '../contentKernel.js';
import type { SpaPollTimer } from '../contentKernel.js';
import { FakeScheduler } from './helpers/fakeScheduler.js';
import { InMemoryStoragePort } from '../../utils/storage/storagePort.js';
import { InMemoryDomainPolicyPort } from './helpers/inMemoryDomainPolicyPort.js';
import { PageState } from '../pageState.js';
import type { MessageSender } from '../visitReporter.js';

const BASE = 1_000_000;

function makeKernel(pageState: PageState, now: number): ContentKernel {
  const sender = { sendMessageWithRetry: vi.fn(() => Promise.resolve({ success: true })) };
  return new ContentKernel(new InMemoryStoragePort(), new InMemoryDomainPolicyPort(), () => now, new FakeScheduler(), {
    pageState,
    sender: sender as unknown as MessageSender,
    isE2ETest: () => false,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ContentKernel SPA seam — URL comparison guard (No.2)', () => {
  it('does not reset on a same-URL pushState (shallow state update)', () => {
    const pageState = new PageState();
    pageState.startTime = BASE;
    pageState.maxScrollPercentage = 80;
    pageState.isValidVisitReported = true;
    const kernel = makeKernel(pageState, BASE + 9000);
    const originalHref = window.location.href;
    const unsubscribe = kernel.subscribeSpaNavigation();
    try {
      // Shallow update: push the exact current URL.
      window.history.pushState({}, '', window.location.href);
      expect(pageState.startTime).toBe(BASE);
      expect(pageState.maxScrollPercentage).toBe(80);
      expect(pageState.isValidVisitReported).toBe(true);
      expect(kernel.pollSpaUrlOnce()).toBe(false);
    } finally {
      unsubscribe();
      window.history.replaceState({}, '', originalHref);
    }
  });

  it('does not reset on a same-URL replaceState', () => {
    const pageState = new PageState();
    pageState.startTime = BASE;
    pageState.maxScrollPercentage = 40;
    const kernel = makeKernel(pageState, BASE + 5000);
    const originalHref = window.location.href;
    const unsubscribe = kernel.subscribeSpaNavigation();
    try {
      window.history.replaceState({}, '', window.location.href);
      expect(pageState.startTime).toBe(BASE);
      expect(pageState.maxScrollPercentage).toBe(40);
    } finally {
      unsubscribe();
      window.history.replaceState({}, '', originalHref);
    }
  });

  it('resets exactly once on a true URL change through the wrapper', () => {
    const pageState = new PageState();
    pageState.startTime = BASE;
    pageState.maxScrollPercentage = 80;
    pageState.isValidVisitReported = true;
    const kernel = makeKernel(pageState, BASE + 9000);
    const originalHref = window.location.href;
    const unsubscribe = kernel.subscribeSpaNavigation();
    try {
      window.history.pushState({}, '', '/spa-true-page');
      expect(pageState.startTime).toBe(BASE + 9000);
      expect(pageState.maxScrollPercentage).toBe(0);
      expect(pageState.isValidVisitReported).toBe(false);
      // A second poll with no further movement reports no change.
      expect(kernel.pollSpaUrlOnce()).toBe(false);
    } finally {
      unsubscribe();
      window.history.replaceState({}, '', originalHref);
    }
  });
});

describe('ContentKernel SPA seam — startPeriodicCheck restarts the poll (No.1)', () => {
  it('re-arms a stopped poll on startPeriodicCheck without stacking timers', () => {
    const pageState = new PageState();
    pageState.startTime = BASE;
    pageState.maxScrollPercentage = 55;
    const kernel = makeKernel(pageState, BASE + 9000);
    const originalHref = window.location.href;
    const tickBox: { current: (() => void) | null } = { current: null };
    let setCalls = 0;
    const timer: SpaPollTimer = {
      setInterval: (callback) => {
        setCalls += 1;
        tickBox.current = callback;
        return setCalls as unknown as ReturnType<typeof setInterval>;
      },
      clearInterval: () => {
        tickBox.current = null;
      },
    };
    kernel.startSpaUrlPolling(2000, timer);
    expect(setCalls).toBe(1);
    expect(tickBox.current).not.toBeNull();

    // stopPeriodicCheck stops the MAIN-world poll with the deadline timer.
    kernel.stopPeriodicCheck();
    expect(tickBox.current).toBeNull();

    // startPeriodicCheck re-arms the same poll (symmetric restart).
    kernel.startPeriodicCheck();
    expect(setCalls).toBe(2);
    expect(tickBox.current).not.toBeNull();

    // Multi-start guard: a repeated start never stacks a second interval.
    kernel.startPeriodicCheck();
    expect(setCalls).toBe(2);
    expect(tickBox.current).not.toBeNull();

    // The re-armed poll still detects a MAIN-world transition.
    const rawPush = window.history.pushState.bind(window.history);
    try {
      rawPush.call(window.history, {}, '', '/restarted-poll-page');
      tickBox.current?.();
      expect(pageState.startTime).toBe(BASE + 9000);
      expect(pageState.maxScrollPercentage).toBe(0);
    } finally {
      kernel.stopPeriodicCheck();
      window.history.replaceState({}, '', originalHref);
    }
  });
});

describe('ContentKernel SPA seam — hash-only moves never reset (No.2)', () => {
  it('ignores fragment-only changes but still resets on a true path change', () => {
    const pageState = new PageState();
    pageState.startTime = BASE;
    pageState.maxScrollPercentage = 70;
    pageState.isValidVisitReported = true;
    const kernel = makeKernel(pageState, BASE + 9000);
    const originalHref = window.location.href;
    const baseNoHash = originalHref.split('#')[0] ?? originalHref;
    const unsubscribe = kernel.subscribeSpaNavigation();
    try {
      window.history.pushState({}, '', `${baseNoHash}#section-a`);
      expect(kernel.pollSpaUrlOnce()).toBe(false);
      window.history.pushState({}, '', `${baseNoHash}#section-b`);
      expect(kernel.pollSpaUrlOnce()).toBe(false);
      expect(pageState.startTime).toBe(BASE);
      expect(pageState.maxScrollPercentage).toBe(70);
      expect(pageState.isValidVisitReported).toBe(true);
      // A true path change after the anchor hops still resets.
      window.history.pushState({}, '', '/hash-then-real-page');
      expect(pageState.startTime).toBe(BASE + 9000);
      expect(pageState.maxScrollPercentage).toBe(0);
      expect(pageState.isValidVisitReported).toBe(false);
    } finally {
      unsubscribe();
      window.history.replaceState({}, '', originalHref);
    }
  });
});

describe('ContentKernel SPA seam — MAIN-world polling backing (No.1)', () => {
  it('records the subscribed URL so the first poll is a no-op', () => {
    const kernel = makeKernel(new PageState(), BASE);
    const unsubscribe = kernel.subscribeSpaNavigation();
    try {
      expect(kernel.getLastSpaUrl()).toBe(window.location.href);
      expect(kernel.pollSpaUrlOnce()).toBe(false);
    } finally {
      unsubscribe();
    }
  });

  it('detects a MAIN-world transition the isolated wrappers cannot see', () => {
    const pageState = new PageState();
    pageState.startTime = BASE;
    pageState.maxScrollPercentage = 70;
    const kernel = makeKernel(pageState, BASE + 9000);
    const originalHref = window.location.href;
    // Capture the raw history methods BEFORE subscribing: driving them
    // directly simulates a MAIN-world pushState that bypasses the isolated
    // wrappers (the wrappers are layered on top of these exact functions).
    const rawPush = window.history.pushState.bind(window.history);
    const unsubscribe = kernel.subscribeSpaNavigation();
    try {
      rawPush.call(window.history, {}, '', '/main-world-page');
      // The isolated wrapper never ran, yet the poll sees the new URL.
      expect(kernel.pollSpaUrlOnce()).toBe(true);
      expect(pageState.startTime).toBe(BASE + 9000);
      expect(pageState.maxScrollPercentage).toBe(0);
    } finally {
      unsubscribe();
      window.history.replaceState({}, '', originalHref);
    }
  });

  it('startSpaUrlPolling drives the same guarded path on a fake timer', () => {
    const pageState = new PageState();
    pageState.startTime = BASE;
    pageState.maxScrollPercentage = 60;
    const kernel = makeKernel(pageState, BASE + 9000);
    const originalHref = window.location.href;
    const rawPush = window.history.pushState.bind(window.history);
    // Boxed so CFA does not narrow the callback slot to null: the assignment
    // runs inside the timer closure, which straight-line narrowing ignores.
    const tickBox: { current: (() => void) | null } = { current: null };
    const timer: SpaPollTimer = {
      setInterval: (callback) => {
        tickBox.current = callback;
        return 1 as unknown as ReturnType<typeof setInterval>;
      },
      clearInterval: () => {
        tickBox.current = null;
      },
    };
    const stop = kernel.startSpaUrlPolling(2000, timer);
    try {
      expect(tickBox.current).not.toBeNull();
      // No movement yet: a tick is a no-op.
      tickBox.current?.();
      expect(pageState.maxScrollPercentage).toBe(60);
      // MAIN-world movement: the next tick resets through the guard.
      rawPush.call(window.history, {}, '', '/main-world-polled');
      tickBox.current?.();
      expect(pageState.startTime).toBe(BASE + 9000);
      expect(pageState.maxScrollPercentage).toBe(0);
    } finally {
      stop();
      expect(tickBox.current).toBeNull();
      // stop() is idempotent-safe: stopping twice via stopPeriodicCheck path.
      kernel.stopPeriodicCheck();
      window.history.replaceState({}, '', originalHref);
    }
  });
});
