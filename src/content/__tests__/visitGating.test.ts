// @vitest-environment jsdom
/**
 * visitGating.test.ts (PBI 2026-09-23-08)
 * Pins the VisitGating single-owner seam: evaluate(state, now) verdict
 * parity with the retired 3-site/2-fallback chain, single gate lifetime,
 * drift rebuild, pre-init nullable fallback, and the settings-table move.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ContentKernel } from '../contentKernel.js';
import { VisitGating, applySettingsTable } from '../visitGating.js';
import { VisitGate } from '../visitGate.js';
import { PageState } from '../pageState.js';
import { FakeScheduler } from './helpers/fakeScheduler.js';
import { InMemoryStoragePort } from '../../utils/storage/storagePort.js';
import { InMemoryDomainPolicyPort } from './helpers/inMemoryDomainPolicyPort.js';
import { StorageKeys } from '../../utils/storage/types.js';
import { THRESHOLD_RULES } from '../../utils/aiSummaryCleaner/rules.js';

const BASE = 1_000_000;

function makeGating(pageState: PageState, now: () => number, isE2E = false): { gating: VisitGating; clock: () => number } {
    let t = now();
    const clock = () => t;
    const gating = new VisitGating({ getPageState: () => pageState, clock, isE2ETest: () => isE2E });
    return { gating, clock };
}

/** The retired chain, replicated literally for parity comparison. */
function legacyVerdict(pageState: PageState, gate: VisitGate | null, thresholds: { minDuration: number; minScroll: number } | null, clock: () => number): boolean {
    const state = pageState.toVisitState();
    const resolvedThresholds = thresholds ?? pageState.toVisitGateThresholds();
    void resolvedThresholds;
    const resolvedGate = gate ?? new VisitGate(pageState.toVisitGateThresholds(), clock);
    return resolvedGate.isReportable(state);
}

describe('VisitGating.evaluate — verdict parity with the retired chain', () => {
    it.each([
        { elapsedMs: 6000, scroll: 60, reported: false, expected: true },
        { elapsedMs: 4000, scroll: 80, reported: false, expected: false },
        { elapsedMs: 6000, scroll: 30, reported: false, expected: false },
        { elapsedMs: 2000, scroll: 10, reported: false, expected: false },
        { elapsedMs: 10000, scroll: 100, reported: true, expected: false },
        { elapsedMs: 5000, scroll: 50, reported: false, expected: true },
        { elapsedMs: 4999, scroll: 50, reported: false, expected: false },
        { elapsedMs: -5000, scroll: 100, reported: false, expected: false },
    ])('elapsed=%i scroll=%i reported=%s => %s', ({ elapsedMs, scroll, reported, expected }) => {
        const pageState = new PageState();
        pageState.startTime = BASE;
        pageState.maxScrollPercentage = scroll;
        pageState.isValidVisitReported = reported;
        const { gating, clock } = makeGating(pageState, () => BASE + elapsedMs);
        gating.initialize();
        const now = clock();
        const result = gating.evaluate(pageState.toVisitState(), now);
        expect(result.reportable).toBe(expected);
        expect(result.reportable).toBe(legacyVerdict(pageState, gating.gate, gating.thresholds, clock));
        expect(result.duration).toBe((now - BASE) / 1000);
        expect(result.thresholds).toEqual({ minDuration: 5, minScroll: 50 });
    });

    it('matches legacy across threshold drift without re-init', () => {
        const pageState = new PageState();
        pageState.startTime = BASE;
        pageState.maxScrollPercentage = 80;
        const { gating, clock } = makeGating(pageState, () => BASE + 4000);
        gating.initialize();
        // Drift: thresholds change after init (settings reload path).
        pageState.minVisitDuration = 3;
        pageState.minScrollDepth = 70;
        const now = clock();
        const result = gating.evaluate(pageState.toVisitState(), now);
        expect(result.thresholds).toEqual({ minDuration: 3, minScroll: 70 });
        expect(result.reportable).toBe(true);
        expect(result.reportable).toBe(legacyVerdict(pageState, gating.gate, gating.thresholds, clock));
    });

    it('pre-init null caches fall back to the live projection instead of crashing', () => {
        const pageState = new PageState();
        pageState.startTime = BASE;
        pageState.maxScrollPercentage = 80;
        const { gating, clock } = makeGating(pageState, () => BASE + 6000);
        // No initialize(): explicit pre-init error mode — nullable reads.
        expect(gating.thresholds).toBeNull();
        expect(gating.gate).toBeNull();
        expect(gating.isE2E).toBe(false);
        const result = gating.evaluate(pageState.toVisitState(), clock());
        expect(result.reportable).toBe(true);
        expect(result.thresholds).toEqual({ minDuration: 5, minScroll: 50 });
        expect(result.reportable).toBe(legacyVerdict(pageState, gating.gate, gating.thresholds, clock));
    });
});

describe('VisitGating — single gate lifetime', () => {
    it('N evaluations construct exactly one gate while fresh', async () => {
        const pageState = new PageState();
        pageState.startTime = BASE;
        const clock = () => BASE + 1000;
        const gating = new VisitGating({ getPageState: () => pageState, clock, isE2ETest: () => false });
        const VisitGateModule = await import('../visitGate.js');
        let constructCount = 0;
        const OrigGate = VisitGateModule.VisitGate;
        const spy = vi
            .spyOn(VisitGateModule, 'VisitGate' as unknown as never)
            .mockImplementation(function (this: unknown, ...args: unknown[]) {
                constructCount++;
                return new (OrigGate as unknown as new (...a: unknown[]) => unknown)(...(args as []));
            }) as unknown as { mockRestore: () => void };
        try {
            gating.initialize();
            expect(constructCount).toBe(1);
            const thresholdsSpy = vi.spyOn(pageState, 'toVisitGateThresholds');
            for (let i = 0; i < 10; i++) {
                gating.evaluate(pageState.toVisitState(), clock());
            }
            expect(constructCount).toBe(1);
            expect(thresholdsSpy).not.toHaveBeenCalled();
        } finally {
            spy.mockRestore();
        }
    });

    it('drift triggers exactly one rebuild and the timer-visible gate updates', () => {
        const pageState = new PageState();
        pageState.startTime = BASE;
        const clock = () => BASE + 1000;
        const gating = new VisitGating({ getPageState: () => pageState, clock, isE2ETest: () => false });
        gating.initialize();
        const first = gating.gate;
        pageState.minVisitDuration = 9;
        expect(gating.refreshCachesIfStale()).toBe(true);
        expect(gating.gate).not.toBe(first);
        expect(gating.thresholds).toEqual({ minDuration: 9, minScroll: 50 });
        expect(gating.refreshCachesIfStale()).toBe(false);
    });

    it('createGate binds to live thresholds and honors clock injection', () => {
        const pageState = new PageState();
        pageState.minVisitDuration = 3;
        pageState.minScrollDepth = 10;
        const gating = new VisitGating({ getPageState: () => pageState, clock: () => 0, isE2ETest: () => false });
        const gate = gating.createGate(() => BASE + 5000);
        expect(gate.shouldRecord(3, 10)).toBe(true);
        expect(gate.shouldRecord(2, 10)).toBe(false);
    });

    it('shouldRecord honors explicit overrides without touching caches', () => {
        const pageState = new PageState();
        const gating = new VisitGating({ getPageState: () => pageState, clock: () => 0, isE2ETest: () => false });
        expect(gating.shouldRecord(3, 10, 2, 5)).toBe(true);
        expect(gating.shouldRecord(3, 10, 5, 5)).toBe(false);
        expect(gating.shouldRecord(3, 10, 2, 20)).toBe(false);
        expect(gating.shouldRecord(5, 50)).toBe(true);
        expect(gating.thresholds).toBeNull();
        expect(gating.gate).toBeNull();
    });
});

describe('applySettingsTable — the moved loadSettings mapping', () => {
    it('maps duration/depth and falls back to defaults on NaN', () => {
        const pageState = new PageState();
        applySettingsTable(pageState, {
            [StorageKeys.MIN_VISIT_DURATION]: '12',
            [StorageKeys.MIN_SCROLL_DEPTH]: '70',
        });
        expect(pageState.minVisitDuration).toBe(12);
        expect(pageState.minScrollDepth).toBe(70);
        applySettingsTable(pageState, {
            [StorageKeys.MIN_VISIT_DURATION]: 'not-a-number',
            [StorageKeys.MIN_SCROLL_DEPTH]: 'not-a-number',
        });
        expect(pageState.minVisitDuration).toBe(5);
        expect(pageState.minScrollDepth).toBe(50);
    });

    it('clamps threshold rules via THRESHOLD_RULES', () => {
        const pageState = new PageState();
        const rule = THRESHOLD_RULES[0]!;
        applySettingsTable(pageState, { [rule.storageKey]: 9999 });
        expect(pageState.cleansingConfig[rule.prop]).toBe(rule.max);
    });

    it('maps boolean cleansing flags', () => {
        const pageState = new PageState();
        applySettingsTable(pageState, { [StorageKeys.AI_SUMMARY_CLEANSING_ENABLED]: false });
        expect(pageState.cleansingConfig.aiSummaryCleansingEnabled).toBe(false);
    });
});

describe('kernel seam pins (PBI 2026-09-23-08 DoD)', () => {
    const kernelSrc = readFileSync(join(process.cwd(), 'src/content/contentKernel.ts'), 'utf8');
    const timerSrc = readFileSync(join(process.cwd(), 'src/content/deadlineTimer.ts'), 'utf8');

    it('gate construction lives only in the gating module', () => {
        expect(kernelSrc).not.toMatch(/new\s+VisitGate/);
        expect(timerSrc).not.toMatch(/new\s+VisitGate/);
    });

    it('the scheduler implementation lives outside the kernel', () => {
        expect(kernelSrc).not.toMatch(/class\s+IdleScheduler/);
    });

    it('E2E __OW_TEST_STATE shape is unchanged through the kernel adapter', () => {
        const pageState = new PageState();
        pageState.startTime = BASE;
        pageState.maxScrollPercentage = 80;
        const storage = new InMemoryStoragePort();
        const policy = new InMemoryDomainPolicyPort();
        const sender = { sendMessageWithRetry: vi.fn(() => Promise.resolve({ success: true })) };
        const kernel = new ContentKernel(storage, policy, () => BASE + 6000, new FakeScheduler(), {
            pageState,
            sender: sender as unknown as import('../visitReporter.js').MessageSender,
            isE2ETest: () => true,
        });
        kernel.checkVisitConditions();
        const state = (window as unknown as { __OW_TEST_STATE?: Record<string, unknown> }).__OW_TEST_STATE;
        expect(state).toBeDefined();
        expect(Object.keys(state!)).toEqual([
            'maxScrollPercentage',
            'isValidVisitReported',
            'startTime',
            'minVisitDuration',
            'minScrollDepth',
            'duration',
        ]);
        expect(document.documentElement.getAttribute('data-ow-test-state')).toContain('maxScrollPercentage');
        delete (window as unknown as { __OW_TEST_STATE?: unknown }).__OW_TEST_STATE;
        document.documentElement.removeAttribute('data-ow-test-state');
    });
});
