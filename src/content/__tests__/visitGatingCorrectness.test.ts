// @vitest-environment jsdom
/**
 * visitGatingCorrectness.test.ts (PBI 2026-11-08-02)
 * Regression pins for the six verified visit-gating findings:
 * (1) SPA navigation resets startTime/thresholds via history subscription,
 * (2) staleness detects mediaKind transitions and override-only changes,
 * (3) out-of-range thresholds are clamped, (4) abnormal innerHeight falls
 * back to a safe side, (5) throttling survives a missing performance clock,
 * (6) invalid-context detection does not depend on message wording.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useTimerClock } from '../../../testDir/waitPolicy.js';
import { ContentKernel } from '../contentKernel.js';
import { FakeScheduler } from './helpers/fakeScheduler.js';
import { InMemoryStoragePort } from '../../utils/storage/storagePort.js';
import { InMemoryDomainPolicyPort } from './helpers/inMemoryDomainPolicyPort.js';
import { PageState } from '../pageState.js';
import { VisitGate } from '../visitGate.js';
import {
    VisitGating,
    applySettingsTable,
    sanitizeVisitThreshold,
    MIN_VISIT_DURATION_FLOOR,
    MIN_VISIT_DURATION_CEIL,
    MIN_SCROLL_DEPTH_FLOOR,
    MIN_SCROLL_DEPTH_CEIL,
} from '../visitGating.js';
import { computeMaxScroll, ScrollMonitor } from '../scrollMonitor.js';
import { throttle } from '../throttle.js';
import {
    VisitReporter,
    isContextInvalidatedMessage,
    type MessageSender,
} from '../visitReporter.js';
import { DEFAULT_MIN_VISIT_DURATION, DEFAULT_MIN_SCROLL_DEPTH } from '../../utils/visitThresholds.js';
import { StorageKeys } from '../../utils/storage/types.js';

const BASE = 1_000_000;

function makeKernel(pageState: PageState, clock: () => number): ContentKernel {
    const sender = { sendMessageWithRetry: vi.fn(() => Promise.resolve({ success: true })) };
    return new ContentKernel(new InMemoryStoragePort(), new InMemoryDomainPolicyPort(), clock, new FakeScheduler(), {
        pageState,
        sender: sender as unknown as MessageSender,
        isE2ETest: () => false,
    });
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('visitGatingCorrectness (PBI 2026-11-08-02)', () => {
    describe('spaNavigation', () => {
        it('judges the new page with fresh startTime and fresh thresholds after navigation', () => {
            const pageState = new PageState();
            pageState.startTime = BASE;
            pageState.maxScrollPercentage = 100;
            const kernel = makeKernel(pageState, () => BASE + 6000);
            // New page view starts 6s in; the new page requires 30s dwell.
            kernel.resetForNavigation(BASE + 6000);
            applySettingsTable(pageState, { [StorageKeys.MIN_VISIT_DURATION]: '30' });
            expect(pageState.maxScrollPercentage).toBe(0);
            expect(pageState.isValidVisitReported).toBe(false);
            // +14s on the new page (would have been 20s >= 5s on the old startTime).
            pageState.maxScrollPercentage = 100;
            const fresh = new VisitGating({
                getPageState: () => pageState,
                clock: () => BASE + 20000,
                isE2ETest: () => false,
            });
            fresh.initialize();
            const notYet = fresh.evaluate(pageState.toVisitState(), BASE + 20000);
            expect(notYet.thresholds).toEqual({ minDuration: 30, minScroll: 50 });
            expect(notYet.reportable).toBe(false);
            // +34s on the new page clears the new 30s bar.
            const lateClock = (): number => BASE + 40000;
            const late = new VisitGating({ getPageState: () => pageState, clock: lateClock, isE2ETest: () => false });
            late.initialize();
            expect(late.evaluate(pageState.toVisitState(), BASE + 40000).reportable).toBe(true);
        });

        it('resets visit state when history.pushState fires while subscribed', () => {
            const pageState = new PageState();
            pageState.startTime = BASE;
            pageState.maxScrollPercentage = 80;
            pageState.isValidVisitReported = true;
            const kernel = makeKernel(pageState, () => BASE + 9000);
            const originalHref = window.location.href;
            const unsubscribe = kernel.subscribeSpaNavigation();
            try {
                window.history.pushState({}, '', '/spa-next-page');
                expect(pageState.startTime).toBe(BASE + 9000);
                expect(pageState.maxScrollPercentage).toBe(0);
                expect(pageState.isValidVisitReported).toBe(false);
            } finally {
                unsubscribe();
                window.history.replaceState({}, '', originalHref);
            }
            // Unsubscribed: navigation no longer touches the visit state.
            pageState.maxScrollPercentage = 80;
            window.history.pushState({}, '', '/spa-untracked');
            try {
                expect(pageState.maxScrollPercentage).toBe(80);
            } finally {
                window.history.replaceState({}, '', originalHref);
            }
        });

        it('exposes the SPA seam on the extractor singleton', async () => {
            const extractor = await import('../extractor.js');
            expect(typeof extractor.resetForSpaNavigation).toBe('function');
            expect(typeof extractor.subscribeSpaNavigation).toBe('function');
            const before = extractor.kernel.pageState.startTime;
            extractor.resetForSpaNavigation(before + 10_000);
            try {
                expect(extractor.kernel.pageState.startTime).toBe(before + 10_000);
                expect(extractor.kernel.pageState.maxScrollPercentage).toBe(0);
            } finally {
                extractor.kernel.stopPeriodicCheck();
            }
        });
    });

    describe('stalenessDetection', () => {
        it('rebuilds when the media kind transitions from article to video', () => {
            const pageState = new PageState();
            pageState.startTime = BASE;
            let kind = 'article';
            const gating = new VisitGating({
                getPageState: () => pageState,
                clock: () => BASE,
                isE2ETest: () => false,
                detectMediaKind: () => kind,
                getMediaThresholdOverrides: () => ({}),
            });
            gating.initialize();
            expect(gating.thresholds).toEqual({ minDuration: 5, minScroll: 50 });
            kind = 'video';
            expect(gating.refreshCachesIfStale()).toBe(true);
            expect(gating.thresholds?.minDuration).toBe(30);
            expect(gating.refreshCachesIfStale()).toBe(false);
        });

        it('rebuilds on an override-only change without any pageState move', () => {
            const pageState = new PageState();
            pageState.startTime = BASE;
            let overrides: Record<string, Record<string, number>> = {};
            const gating = new VisitGating({
                getPageState: () => pageState,
                clock: () => BASE,
                isE2ETest: () => false,
                detectMediaKind: () => 'video',
                getMediaThresholdOverrides: () => overrides,
            });
            gating.initialize();
            expect(gating.thresholds?.minDuration).toBe(30);
            expect(gating.refreshCachesIfStale()).toBe(false);
            overrides = { video: { minDuration: 60 } };
            expect(gating.refreshCachesIfStale()).toBe(true);
            expect(gating.thresholds?.minDuration).toBe(60);
        });

        it('does not rebuild a media gate on every evaluation while fresh', () => {
            const pageState = new PageState();
            pageState.startTime = BASE;
            const gating = new VisitGating({
                getPageState: () => pageState,
                clock: () => BASE,
                isE2ETest: () => false,
                detectMediaKind: () => 'video',
                getMediaThresholdOverrides: () => ({}),
            });
            gating.initialize();
            const gate = gating.gate;
            for (let i = 0; i < 5; i++) {
                expect(gating.refreshCachesIfStale()).toBe(false);
            }
            expect(gating.gate).toBe(gate);
        });
    });

    describe('thresholdRangeValidation', () => {
        it.each([
            { raw: '0', expected: MIN_VISIT_DURATION_FLOOR },
            { raw: '-5', expected: MIN_VISIT_DURATION_FLOOR },
            { raw: '12', expected: 12 },
            { raw: '999999', expected: MIN_VISIT_DURATION_CEIL },
        ])('clamps duration $raw to $expected', ({ raw, expected }) => {
            const pageState = new PageState();
            applySettingsTable(pageState, { [StorageKeys.MIN_VISIT_DURATION]: raw });
            expect(pageState.minVisitDuration).toBe(expected);
        });

        it.each([
            { raw: '-5', expected: MIN_SCROLL_DEPTH_FLOOR },
            { raw: '0', expected: 0 },
            { raw: '70', expected: 70 },
            { raw: '500', expected: MIN_SCROLL_DEPTH_CEIL },
        ])('clamps scroll depth $raw to $expected', ({ raw, expected }) => {
            const pageState = new PageState();
            applySettingsTable(pageState, { [StorageKeys.MIN_SCROLL_DEPTH]: raw });
            expect(pageState.minScrollDepth).toBe(expected);
        });

        it('falls back to defaults on non-numeric input', () => {
            const pageState = new PageState();
            applySettingsTable(pageState, {
                [StorageKeys.MIN_VISIT_DURATION]: 'not-a-number',
                [StorageKeys.MIN_SCROLL_DEPTH]: 'not-a-number',
            });
            expect(pageState.minVisitDuration).toBe(DEFAULT_MIN_VISIT_DURATION);
            expect(pageState.minScrollDepth).toBe(DEFAULT_MIN_SCROLL_DEPTH);
        });

        it('never fires instantly on a clamped zero duration and still fires on a clamped huge one', () => {
            const zeroClamped = sanitizeVisitThreshold(0, MIN_VISIT_DURATION_FLOOR, MIN_VISIT_DURATION_CEIL, 5);
            expect(zeroClamped).toBeGreaterThan(0);
            expect(new VisitGate({ minDuration: zeroClamped, minScroll: 0 }).shouldRecord(0, 100)).toBe(false);
            const hugeClamped = sanitizeVisitThreshold(999999, MIN_VISIT_DURATION_FLOOR, MIN_VISIT_DURATION_CEIL, 5);
            expect(hugeClamped).toBe(MIN_VISIT_DURATION_CEIL);
            expect(new VisitGate({ minDuration: hugeClamped, minScroll: 100 }).shouldRecord(3600, 100)).toBe(true);
        });
    });

    describe('scrollMonitorViewport', () => {
        function stubWindowMetrics(metrics: { scrollY: number; innerHeight: number; clientHeight: number; scrollHeight: number }): () => void {
            const prevScrollY = window.scrollY;
            const prevInnerHeight = window.innerHeight;
            const prevClientHeight = document.documentElement.clientHeight;
            const prevScrollHeight = document.documentElement.scrollHeight;
            Object.defineProperty(window, 'scrollY', { value: metrics.scrollY, writable: true, configurable: true });
            Object.defineProperty(window, 'innerHeight', { value: metrics.innerHeight, writable: true, configurable: true });
            Object.defineProperty(document.documentElement, 'clientHeight', { value: metrics.clientHeight, writable: true, configurable: true });
            Object.defineProperty(document.documentElement, 'scrollHeight', { value: metrics.scrollHeight, writable: true, configurable: true });
            return () => {
                Object.defineProperty(window, 'scrollY', { value: prevScrollY, writable: true, configurable: true });
                Object.defineProperty(window, 'innerHeight', { value: prevInnerHeight, writable: true, configurable: true });
                Object.defineProperty(document.documentElement, 'clientHeight', { value: prevClientHeight, writable: true, configurable: true });
                Object.defineProperty(document.documentElement, 'scrollHeight', { value: prevScrollHeight, writable: true, configurable: true });
            };
        }

        it('falls back to clientHeight when innerHeight is NaN', () => {
            const restore = stubWindowMetrics({ scrollY: 500, innerHeight: NaN, clientHeight: 600, scrollHeight: 1600 });
            try {
                const pageState = new PageState();
                const monitor = new ScrollMonitor(pageState);
                // viewport 600 -> docHeight 1000 -> 50%, not a silent maintain.
                expect(monitor.updateFromWindow()).toBe(50);
                expect(pageState.maxScrollPercentage).toBe(50);
            } finally {
                restore();
            }
        });

        it('keeps finite state and recovers when every metric is unreadable', () => {
            const restore = stubWindowMetrics({ scrollY: NaN, innerHeight: NaN, clientHeight: NaN, scrollHeight: NaN });
            try {
                const pageState = new PageState();
                pageState.maxScrollPercentage = 30;
                const monitor = new ScrollMonitor(pageState);
                const next = monitor.updateFromWindow();
                expect(Number.isFinite(next)).toBe(true);
                expect(Number.isFinite(pageState.maxScrollPercentage)).toBe(true);
                expect(next).toBe(30);
            } finally {
                restore();
            }
            // Recovery: a later valid read advances the depth again.
            const restoreValid = stubWindowMetrics({ scrollY: 900, innerHeight: 600, clientHeight: 600, scrollHeight: 1600 });
            try {
                const pageState = new PageState();
                pageState.maxScrollPercentage = 30;
                expect(new ScrollMonitor(pageState).updateFromWindow()).toBe(90);
            } finally {
                restoreValid();
            }
        });

        it('clamps overscroll percentages and heals a NaN current max', () => {
            expect(computeMaxScroll(0, 5000, 1000)).toBe(100);
            expect(computeMaxScroll(NaN, 500, 1000)).toBe(50);
            expect(computeMaxScroll(50, NaN, NaN)).toBe(50);
        });
    });

    describe('throttleWithoutPerformance', () => {
        it('fires leading and trailing calls when performance.now is unavailable', () => {
            vi.stubGlobal('performance', undefined);
            useTimerClock();
            const fn = vi.fn();
            const { fn: throttled, dispose } = throttle(fn, { delayMs: 100 });
            try {
                throttled('a');
                expect(fn).toHaveBeenCalledTimes(1);
                expect(fn).toHaveBeenCalledWith('a');
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

    describe('contextInvalidatedDetection', () => {
        function makeReporterDeps(): {
            deps: {
                pageState: PageState;
                extractAndCommit: () => { content: string };
                sender: { sendMessageWithRetry: ReturnType<typeof vi.fn> };
                stopPeriodicCheck: ReturnType<typeof vi.fn>;
                sleep: (ms: number) => Promise<void>;
            };
        } {
            return {
                deps: {
                    pageState: new PageState(),
                    extractAndCommit: () => ({ content: 'x'.repeat(100) }),
                    sender: { sendMessageWithRetry: vi.fn(() => Promise.resolve({ success: true })) },
                    stopPeriodicCheck: vi.fn(),
                    sleep: () => Promise.resolve(),
                },
            };
        }

        it('exits immediately on a reworded error while the runtime id is gone', async () => {
            vi.stubGlobal('chrome', { runtime: {} });
            const { deps } = makeReporterDeps();
            deps.sender.sendMessageWithRetry.mockRejectedValueOnce(new Error('Worker connection lost (code=7)'));
            await new VisitReporter(deps as unknown as import('../visitReporter.js').VisitReporterDeps).report();
            expect(deps.stopPeriodicCheck).toHaveBeenCalledTimes(1);
            expect(deps.sender.sendMessageWithRetry).toHaveBeenCalledTimes(1);
            expect(deps.pageState.isValidVisitReported).toBe(false);
        });

        it('still exits on the legacy phrase without any chrome globals', async () => {
            const { deps } = makeReporterDeps();
            deps.sender.sendMessageWithRetry.mockRejectedValueOnce(new Error('Extension context invalidated.'));
            await new VisitReporter(deps as unknown as import('../visitReporter.js').VisitReporterDeps).report();
            expect(deps.stopPeriodicCheck).toHaveBeenCalledTimes(1);
            expect(deps.sender.sendMessageWithRetry).toHaveBeenCalledTimes(1);
        });

        it('retries a reworded transient error while the runtime id is present', async () => {
            vi.stubGlobal('chrome', { runtime: { id: 'test-extension-id' } });
            const { deps } = makeReporterDeps();
            deps.sender.sendMessageWithRetry
                .mockRejectedValueOnce(new Error('Service worker busy'))
                .mockResolvedValueOnce({ success: true });
            await new VisitReporter(deps as unknown as import('../visitReporter.js').VisitReporterDeps).report();
            expect(deps.sender.sendMessageWithRetry).toHaveBeenCalledTimes(2);
            expect(deps.pageState.isValidVisitReported).toBe(true);
        });

        it('matches only the context-invalidated family, not bare sendMessage mentions', () => {
            expect(isContextInvalidatedMessage('Extension context invalidated.')).toBe(true);
            expect(isContextInvalidatedMessage('extension CONTEXT invalidated')).toBe(true);
            expect(isContextInvalidatedMessage('Service worker busy')).toBe(false);
            expect(isContextInvalidatedMessage('Failed to sendMessage to worker')).toBe(false);
        });
    });
});
