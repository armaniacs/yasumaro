// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ContentKernel, FakeScheduler } from '../contentKernel.js';
import { InMemoryStoragePort } from '../../utils/storage/storagePort.js';
import { InMemoryDomainPolicyPort } from '../domainPolicyPort.js';
import { PageState } from '../pageState.js';
import * as VisitGateModule from '../visitGate.js';

function makeKernel(opts: {
    baseTime: number;
    clock: () => number;
    scheduler: FakeScheduler;
    pageState: PageState;
    isE2ETest?: () => boolean;
    sender?: { sendMessageWithRetry: ReturnType<typeof vi.fn> };
}) {
    const storage = new InMemoryStoragePort();
    const policy = new InMemoryDomainPolicyPort({}, opts.clock);
    const sender = opts.sender ?? { sendMessageWithRetry: vi.fn(() => Promise.resolve({ success: true })) };
    const kernel = new ContentKernel(storage, policy, opts.clock, opts.scheduler, {
        pageState: opts.pageState,
        sender: sender as unknown as import('../visitReporter.js').MessageSender,
        isE2ETest: opts.isE2ETest ?? (() => false),
    });
    return { kernel, storage, policy, sender };
}

function setDocumentHidden(value: boolean) {
    Object.defineProperty(document, 'hidden', {
        value,
        configurable: true,
        writable: true,
    });
}

describe('ContentKernel polling — one-shot deadline + scroll driven', () => {
    let originalHidden: PropertyDescriptor | undefined;

    beforeEach(() => {
        // Preserve original hidden descriptor
        originalHidden = Object.getOwnPropertyDescriptor(document, 'hidden');
        setDocumentHidden(false);
        document.documentElement.removeAttribute('data-ow-test-state');
        // Clean global __OW_TEST_STATE
        delete (window as unknown as { __OW_TEST_STATE?: unknown }).__OW_TEST_STATE;
    });

    afterEach(() => {
        if (originalHidden) {
            Object.defineProperty(document, 'hidden', originalHidden);
        } else {
            // fallback
            Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        }
        vi.restoreAllMocks();
    });

    it('Scenario 1: deadline not reached → scheduler.schedule called exactly once with 5s delay', async () => {
        const baseTime = 1_000_000;
        let now = baseTime;
        const clock = () => now;
        const scheduler = new FakeScheduler();
        const scheduleSpy = vi.spyOn(scheduler, 'schedule');
        const pageState = new PageState();
        pageState.startTime = baseTime;
        pageState.minVisitDuration = 5;
        pageState.minScrollDepth = 50;

        const { kernel } = makeKernel({ baseTime, clock, scheduler, pageState });

        await kernel.init();

        expect(scheduleSpy).toHaveBeenCalledTimes(1);
        expect(scheduler.pendingCount()).toBe(1);
        expect(scheduler.lastDelay).toBe(5000);

        // Advance clock but not flush — no second schedule should appear
        now = baseTime + 2000;
        expect(scheduler.pendingCount()).toBe(1);
        expect(scheduleSpy).toHaveBeenCalledTimes(1);

        // Flush at deadline (5s): should evaluate once, not reschedule because scroll unmet
        now = baseTime + 5000;
        // maxScroll stays 0 so condition unmet; flush should NOT reschedule
        scheduler.flush();
        // After flush, no pending timer (unmet -> no reschedule)
        expect(scheduler.pendingCount()).toBe(0);
        expect(scheduleSpy).toHaveBeenCalledTimes(1);
        // Ensure no additional schedule after flush
        expect(scheduler.delays.length).toBe(1);
    });

    it('Scenario 2: scroll reaching conditions → reportValidVisit called + timer stopped', async () => {
        const baseTime = 2_000_000;
        let now = baseTime + 6000; // 6s elapsed (>5s)
        const clock = () => now;
        const scheduler = new FakeScheduler();
        const pageState = new PageState();
        pageState.startTime = baseTime;
        pageState.minVisitDuration = 5;
        pageState.minScrollDepth = 50;
        pageState.maxScrollPercentage = 0;

        const { kernel } = makeKernel({ baseTime, clock, scheduler, pageState });
        await kernel.init();

        expect(scheduler.pendingCount()).toBe(1);

        const reportSpy = vi.spyOn(kernel, 'reportValidVisit').mockImplementation(async () => {
            // mimic VisitReporter setting the flag
            kernel.pageState.isValidVisitReported = true;
            return Promise.resolve();
        });

        // Simulate scroll reaching 60% — set maxScroll before updateMaxScroll,
        // and stub updateFromWindow to keep our value (prevent window globals overwriting)
        // We achieve this by setting window.scrollY/docHeight to yield 60% OR by directly setting pageState.
        pageState.maxScrollPercentage = 60;
        // Mock scrollMonitor.updateFromWindow to no-op keep 60
        // ContentKernel.updateMaxScroll calls scrollMonitor.updateFromWindow() then checkVisitConditions.
        // To keep 60, make window produce 60% as well.
        Object.defineProperty(window, 'scrollY', { value: 600, writable: true, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: 400, writable: true, configurable: true });
        Object.defineProperty(document.documentElement, 'scrollHeight', { value: 1600, writable: true, configurable: true });
        // 1600-400=1200 docHeight, 600/1200=50% -> would be 50, need 60 => set scrollY 720
        Object.defineProperty(window, 'scrollY', { value: 720, writable: true, configurable: true });

        // Trigger scroll-driven evaluation via updateMaxScroll (throttled handler path)
        kernel.updateMaxScroll();

        // Allow microtask for reportValidVisit (void)
        await Promise.resolve();
        await Promise.resolve();

        expect(reportSpy).toHaveBeenCalledTimes(1);
        // Timer should be stopped after report
        expect(scheduler.pendingCount()).toBe(0);
        expect(kernel.pageState.isValidVisitReported).toBe(true);
        // No further schedules
        expect(scheduler.delays.length).toBe(1);
    });

    it('Scenario 3: visibilitychange hidden → cancel; visible → rescheduled with remaining time', async () => {
        const baseTime = 3_000_000;
        let now = baseTime;
        const clock = () => now;
        const scheduler = new FakeScheduler();
        const scheduleSpy = vi.spyOn(scheduler, 'schedule');
        const pageState = new PageState();
        pageState.startTime = baseTime;
        pageState.minVisitDuration = 5;
        pageState.minScrollDepth = 50;

        const { kernel } = makeKernel({ baseTime, clock, scheduler, pageState });
        await kernel.init();

        expect(scheduler.pendingCount()).toBe(1);
        expect(scheduler.lastDelay).toBe(5000);
        expect(scheduleSpy).toHaveBeenCalledTimes(1);

        // Advance 2s then hide
        now = baseTime + 2000;
        setDocumentHidden(true);
        document.dispatchEvent(new Event('visibilitychange'));

        expect(scheduler.pendingCount()).toBe(0);

        // Visible again — should reschedule with remaining 3000ms
        setDocumentHidden(false);
        document.dispatchEvent(new Event('visibilitychange'));

        expect(scheduler.pendingCount()).toBe(1);
        expect(scheduleSpy).toHaveBeenCalledTimes(2);
        expect(scheduler.lastDelay).toBe(3000);
        // Verify via clock injection: remaining = deadline - clock = 5000 - 2000 = 3000
        expect(scheduler.delays[1]).toBe(3000);

        // Hidden again then visible near deadline — remaining clamped to 0
        now = baseTime + 4900;
        setDocumentHidden(true);
        document.dispatchEvent(new Event('visibilitychange'));
        expect(scheduler.pendingCount()).toBe(0);

        setDocumentHidden(false);
        document.dispatchEvent(new Event('visibilitychange'));
        expect(scheduler.lastDelay).toBe(100); // 5000 - 4900
        expect(scheduler.pendingCount()).toBe(1);

        // Past deadline — clamped to 0
        // Need to cancel first then advance past deadline
        setDocumentHidden(true);
        document.dispatchEvent(new Event('visibilitychange'));
        now = baseTime + 6000;
        setDocumentHidden(false);
        document.dispatchEvent(new Event('visibilitychange'));
        expect(scheduler.lastDelay).toBe(0);
    });

    it('Scenario 4: N condition evaluations → VisitGate constructed exactly once', async () => {
        const baseTime = 4_000_000;
        const now = baseTime + 1000;
        const clock = () => now;
        const scheduler = new FakeScheduler();
        const pageState = new PageState();
        pageState.startTime = baseTime;
        pageState.minVisitDuration = 5;
        pageState.minScrollDepth = 50;

        // Track VisitGate construction without breaking it
        let constructCount = 0;
        const OrigGate = VisitGateModule.VisitGate;
        const gateSpy = vi
            .spyOn(VisitGateModule, 'VisitGate' as unknown as never)
            .mockImplementation(function (this: unknown, ...args: unknown[]) {
                constructCount++;
                return new (OrigGate as unknown as new (...a: unknown[]) => unknown)(...(args as []));
            } as unknown as typeof OrigGate);
        const toThresholdsSpy = vi.spyOn(pageState, 'toVisitGateThresholds');

        const { kernel } = makeKernel({ baseTime, clock, scheduler, pageState });
        await kernel.init();

        expect(constructCount).toBe(1);
        expect(toThresholdsSpy).toHaveBeenCalledTimes(1);
        // reset spy history for thresholds but keep constructCount
        toThresholdsSpy.mockClear();

        // Call checkVisitConditions 10 times
        for (let i = 0; i < 10; i++) {
            kernel.checkVisitConditions();
        }

        // Should still be 1 total (no per-call construction)
        expect(constructCount).toBe(1);
        expect(toThresholdsSpy).not.toHaveBeenCalled();
        gateSpy.mockRestore();
    });

    it('isE2ETest resolved once in init (no per-call hasAttribute)', async () => {
        const baseTime = 5_000_000;
        const clock = () => baseTime + 1000;
        const scheduler = new FakeScheduler();
        const pageState = new PageState();
        pageState.startTime = baseTime;

        const hasAttrSpy = vi.spyOn(document.documentElement, 'hasAttribute');
        const isE2EFn = vi.fn(() => false);

        const { kernel } = makeKernel({ baseTime, clock, scheduler, pageState, isE2ETest: isE2EFn });
        await kernel.init();

        expect(isE2EFn).toHaveBeenCalledTimes(1);
        hasAttrSpy.mockClear();
        isE2EFn.mockClear();

        for (let i = 0; i < 5; i++) kernel.checkVisitConditions();

        expect(isE2EFn).not.toHaveBeenCalled();
        expect(hasAttrSpy).not.toHaveBeenCalled();
    });

    it('untrusted (programmatic) scroll crossing the threshold post-deadline still reports', async () => {
        const baseTime = 7_000_000;
        let now = baseTime + 6000; // past the 5s deadline
        const clock = () => now;
        const scheduler = new FakeScheduler();
        const pageState = new PageState();
        pageState.startTime = baseTime;
        pageState.minVisitDuration = 5;
        pageState.minScrollDepth = 50;

        // Make the document scrollable and start unscrolled
        Object.defineProperty(window, 'innerHeight', { value: 400, writable: true, configurable: true });
        Object.defineProperty(document.documentElement, 'scrollHeight', { value: 1600, writable: true, configurable: true });
        Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });

        const { kernel } = makeKernel({ baseTime, clock, scheduler, pageState });
        await kernel.init();

        const reportSpy = vi.spyOn(kernel, 'reportValidVisit').mockImplementation(async () => {
            kernel.pageState.isValidVisitReported = true;
            return Promise.resolve();
        });

        // Deadline fires: duration met but scroll 0% → unmet, no reschedule
        scheduler.flush();
        expect(reportSpy).not.toHaveBeenCalled();
        expect(scheduler.pendingCount()).toBe(0);

        // Programmatic scroll (dispatched events are untrusted) crossing depth
        Object.defineProperty(window, 'scrollY', { value: 720, writable: true, configurable: true });
        window.dispatchEvent(new Event('scroll'));

        // Exactly one deferred evaluation armed (1s), not a polling loop
        expect(scheduler.pendingCount()).toBe(1);
        expect(scheduler.lastDelay).toBe(1000);

        now += 1000;
        scheduler.flush();
        await Promise.resolve();
        await Promise.resolve();

        expect(reportSpy).toHaveBeenCalledTimes(1);
        expect(kernel.pageState.isValidVisitReported).toBe(true);
    });

    it('keeps public API compatibility: startPeriodicCheck / stopPeriodicCheck / scheduleNextCheck exist', async () => {
        const scheduler = new FakeScheduler();
        const pageState = new PageState();
        const { kernel } = makeKernel({ baseTime: Date.now(), clock: () => Date.now(), scheduler, pageState });
        expect(typeof kernel.startPeriodicCheck).toBe('function');
        expect(typeof kernel.stopPeriodicCheck).toBe('function');
        expect(typeof kernel.scheduleNextCheck).toBe('function');
    });

    it('beforeunload cleanup cancels timer', async () => {
        const baseTime = 6_000_000;
        const clock = () => baseTime;
        const scheduler = new FakeScheduler();
        const pageState = new PageState();
        pageState.startTime = baseTime;
        const { kernel } = makeKernel({ baseTime, clock, scheduler, pageState });
        await kernel.init();
        expect(scheduler.pendingCount()).toBe(1);
        window.dispatchEvent(new Event('beforeunload'));
        expect(scheduler.pendingCount()).toBe(0);
    });
});
