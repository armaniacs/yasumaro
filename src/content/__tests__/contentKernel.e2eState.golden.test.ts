// @vitest-environment jsdom
/**
 * Golden pin for the E2E test-state publication (PBI 2026-10-09-08).
 *
 * Pins the exact values written to both routes — window.__OW_TEST_STATE and
 * the data-ow-test-state attribute — so the publisher refactor is proven
 * behavior-preserving (byte-identical JSON). The expected strings below are
 * hardcoded, independent of the implementation, and field order is part of
 * the contract because JSON.stringify follows object insertion order.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ContentKernel } from '../contentKernel.js';
import { FakeScheduler } from './helpers/fakeScheduler.js';
import { InMemoryStoragePort } from '../../utils/storage/storagePort.js';
import { InMemoryDomainPolicyPort } from './helpers/inMemoryDomainPolicyPort.js';
import { PageState } from '../pageState.js';
import type { MessageSender } from '../visitReporter.js';

const BASE = 1_000_000;

const GOLDEN_CHECK_VISIT =
    '{"maxScrollPercentage":80,"isValidVisitReported":false,"startTime":1000000,"minVisitDuration":5,"minScrollDepth":50,"duration":2}';
const GOLDEN_REPORTABLE =
    '{"maxScrollPercentage":80,"isValidVisitReported":true,"startTime":1000000,"minVisitDuration":5,"minScrollDepth":50,"duration":6}';
const GOLDEN_INIT =
    '{"maxScrollPercentage":0,"isValidVisitReported":false,"startTime":1000000,"minVisitDuration":5,"minScrollDepth":50,"duration":0}';

function makeKernel(pageState: PageState, clock: () => number) {
    const storage = new InMemoryStoragePort();
    const policy = new InMemoryDomainPolicyPort({}, clock);
    const sender = { sendMessageWithRetry: vi.fn(() => Promise.resolve({ success: true })) };
    const kernel = new ContentKernel(storage, policy, clock, new FakeScheduler(), {
        pageState,
        sender: sender as unknown as MessageSender,
        isE2ETest: () => true,
    });
    return { kernel, sender };
}

afterEach(() => {
    delete (window as unknown as { __OW_TEST_STATE?: unknown }).__OW_TEST_STATE;
    document.documentElement.removeAttribute('data-ow-test-state');
    vi.restoreAllMocks();
});

describe('E2E test-state golden pin', () => {
    it('checkVisitConditions publishes byte-identical state to both routes', () => {
        const pageState = new PageState();
        pageState.startTime = BASE;
        pageState.maxScrollPercentage = 80;
        const { kernel } = makeKernel(pageState, () => BASE + 2000);

        kernel.checkVisitConditions();

        const winState = window.__OW_TEST_STATE;
        expect(winState).toEqual({
            maxScrollPercentage: 80,
            isValidVisitReported: false,
            startTime: BASE,
            minVisitDuration: 5,
            minScrollDepth: 50,
            duration: 2,
        });
        expect(Object.keys(winState!)).toEqual([
            'maxScrollPercentage',
            'isValidVisitReported',
            'startTime',
            'minVisitDuration',
            'minScrollDepth',
            'duration',
        ]);
        const attr = document.documentElement.getAttribute('data-ow-test-state');
        expect(attr).toBe(GOLDEN_CHECK_VISIT);
        expect(JSON.parse(attr!)).toEqual(winState);
    });

    it('reportable path updates isValidVisitReported and republishes byte-identically', () => {
        const pageState = new PageState();
        pageState.startTime = BASE;
        pageState.maxScrollPercentage = 80;
        const { kernel } = makeKernel(pageState, () => BASE + 6000);

        kernel.checkVisitConditions();

        const winState = window.__OW_TEST_STATE;
        expect(winState).toEqual({
            maxScrollPercentage: 80,
            isValidVisitReported: true,
            startTime: BASE,
            minVisitDuration: 5,
            minScrollDepth: 50,
            duration: 6,
        });
        const attr = document.documentElement.getAttribute('data-ow-test-state');
        expect(attr).toBe(GOLDEN_REPORTABLE);
        expect(JSON.parse(attr!)).toEqual(winState);
    });

    it('init publishes the initial state (duration 0) byte-identically', async () => {
        const pageState = new PageState();
        pageState.startTime = BASE;
        const { kernel } = makeKernel(pageState, () => BASE);

        await kernel.init();

        expect(document.documentElement.getAttribute('data-ow-test-state')).toBe(GOLDEN_INIT);
    });
});
