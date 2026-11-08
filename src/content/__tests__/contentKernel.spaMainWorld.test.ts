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
    let tick: (() => void) | null = null;
    const timer: SpaPollTimer = {
      setInterval: (callback) => {
        tick = callback;
        return 1 as unknown as ReturnType<typeof setInterval>;
      },
      clearInterval: () => {
        tick = null;
      },
    };
    const stop = kernel.startSpaUrlPolling(2000, timer);
    try {
      expect(tick).not.toBeNull();
      // No movement yet: a tick is a no-op.
      tick?.();
      expect(pageState.maxScrollPercentage).toBe(60);
      // MAIN-world movement: the next tick resets through the guard.
      rawPush.call(window.history, {}, '', '/main-world-polled');
      tick?.();
      expect(pageState.startTime).toBe(BASE + 9000);
      expect(pageState.maxScrollPercentage).toBe(0);
    } finally {
      stop();
      expect(tick).toBeNull();
      // stop() is idempotent-safe: stopping twice via stopPeriodicCheck path.
      kernel.stopPeriodicCheck();
      window.history.replaceState({}, '', originalHref);
    }
  });
});
