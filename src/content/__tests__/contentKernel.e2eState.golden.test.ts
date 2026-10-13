// @vitest-environment jsdom
/**
 * Golden pin for the E2E test-state publication (PBI 2026-10-09-08).
 *
 * Pins the exact values published to the isolated window.__OW_TEST_STATE
 * route. PBI 2026-10-11-08 (NN08) removed the second route (the
 * data-ow-test-state page-DOM attribute) — the probe must never write
 * page-shared DOM, so each case also pins the attribute's absence.
 * Field order is part of the contract because JSON.stringify follows object
 * insertion order.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ContentKernel } from '../contentKernel.js';
import { FakeScheduler } from './helpers/fakeScheduler.js';
import { InMemoryStoragePort } from '../../utils/storage/storagePort.js';
import { InMemoryDomainPolicyPort } from './helpers/inMemoryDomainPolicyPort.js';
import { PageState } from '../pageState.js';
import type { MessageSender } from '../visitReporter.js';

const BASE = 1_000_000;

const GOLDEN_CHECK_VISIT = {
    maxScrollPercentage: 80,
    isValidVisitReported: false,
    startTime: 1000000,
    minVisitDuration: 5,
    minScrollDepth: 50,
    duration: 2,
};
const GOLDEN_REPORTABLE = {
    maxScrollPercentage: 80,
    isValidVisitReported: true,
    startTime: 1000000,
    minVisitDuration: 5,
    minScrollDepth: 50,
    duration: 6,
};

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
    it('checkVisitConditions publishes the golden state to the window route only', () => {
        const pageState = new PageState();
        pageState.startTime = BASE;
        pageState.maxScrollPercentage = 80;
        const { kernel } = makeKernel(pageState, () => BASE + 2000);

        kernel.checkVisitConditions();

        const winState = window.__OW_TEST_STATE;
        expect(winState).toEqual(GOLDEN_CHECK_VISIT);
        expect(Object.keys(winState!)).toEqual([
            'maxScrollPercentage',
            'isValidVisitReported',
            'startTime',
            'minVisitDuration',
            'minScrollDepth',
            'duration',
        ]);
        // NN08: no page-shared DOM route anymore.
        expect(document.documentElement.getAttribute('data-ow-test-state')).toBeNull();
    });

    it('reportable path updates isValidVisitReported and republishes goldens', () => {
        const pageState = new PageState();
        pageState.startTime = BASE;
        pageState.maxScrollPercentage = 80;
        const { kernel } = makeKernel(pageState, () => BASE + 6000);

        kernel.checkVisitConditions();

        const winState = window.__OW_TEST_STATE;
        expect(winState).toEqual(GOLDEN_REPORTABLE);
        expect(document.documentElement.getAttribute('data-ow-test-state')).toBeNull();
    });

    it('init publishes the initial state (duration 0) to the window route only', async () => {
        const pageState = new PageState();
        pageState.startTime = BASE;
        const { kernel } = makeKernel(pageState, () => BASE);

        await kernel.init();

        expect(window.__OW_TEST_STATE).toEqual({
            maxScrollPercentage: 0,
            isValidVisitReported: false,
            startTime: BASE,
            minVisitDuration: 5,
            minScrollDepth: 50,
            duration: 0,
        });
        expect(document.documentElement.getAttribute('data-ow-test-state')).toBeNull();
    });
});
