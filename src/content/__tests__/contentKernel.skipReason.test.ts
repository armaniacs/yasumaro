// @vitest-environment jsdom
/**
 * contentKernel.skipReason.test.ts
 *
 * Content-side skip reason wiring (PBI 2026-10-31-01): the condition-not-met
 * skip decided by the pre-pipeline visit gate is recorded when the page view
 * ends without a settled visit. Content scripts cannot reach
 * chrome.storage.session, so the reason travels as a runtime message and the
 * service worker owns the session leg.
 *
 * Guards pinned here:
 *  - a settled visit (recorded or terminal-refused) records nothing — the
 *    outcome policy already recorded the pipeline-side reason;
 *  - a paused session records nothing — pausing is a user choice, not a
 *    condition skip.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ContentKernel } from '../contentKernel.js';
import { FakeScheduler } from './helpers/fakeScheduler.js';
import { InMemoryStoragePort } from '../../utils/storage/storagePort.js';
import { InMemoryDomainPolicyPort } from './helpers/inMemoryDomainPolicyPort.js';
import { PageState } from '../pageState.js';
import { StorageKeys } from '../../utils/storage/types.js';

const FIXED_NOW = 1_000_000;

function makeKernel(opts: {
    pageState: PageState;
    sender?: { sendMessageWithRetry: ReturnType<typeof vi.fn> };
}) {
    const storage = new InMemoryStoragePort();
    const clock = () => FIXED_NOW;
    const policy = new InMemoryDomainPolicyPort({}, clock);
    const sender = opts.sender ?? { sendMessageWithRetry: vi.fn(() => Promise.resolve({ success: true })) };
    const kernel = new ContentKernel(storage, policy, clock, new FakeScheduler(), {
        pageState: opts.pageState,
        sender: sender as unknown as import('../visitReporter.js').MessageSender,
        isE2ETest: () => false,
    });
    return { kernel, storage, policy, sender };
}

function setDocumentHidden(value: boolean) {
    Object.defineProperty(document, 'hidden', { value, configurable: true, writable: true });
}

beforeEach(() => {
    setDocumentHidden(false);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('ContentKernel skip reason wiring (PBI 2026-10-31-01)', () => {
    it('records the condition-not-met skip reason when the page view ends without a settled visit', async () => {
        const pageState = new PageState();
        pageState.startTime = FIXED_NOW - 3000; // 3s elapsed — below the 5s threshold
        const { kernel, sender } = makeKernel({ pageState });
        await kernel.init();

        window.dispatchEvent(new Event('beforeunload'));

        expect(sender.sendMessageWithRetry).toHaveBeenCalledWith({
            type: 'RECORDING_SKIP_REASON',
            payload: { reason: 'condition-not-met' },
        });
    });

    it('records nothing when the visit settled (recorded or terminal-refused)', async () => {
        const pageState = new PageState();
        pageState.startTime = FIXED_NOW - 3000;
        pageState.isValidVisitReported = true; // the visit settled — the SW side owns the reason
        const { kernel, sender } = makeKernel({ pageState });
        await kernel.init();

        window.dispatchEvent(new Event('beforeunload'));

        expect(sender.sendMessageWithRetry).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'RECORDING_SKIP_REASON' }),
        );
    });

    it('records nothing while recording is paused (a user choice, not a condition skip)', async () => {
        const pageState = new PageState();
        pageState.startTime = FIXED_NOW - 3000;
        vi.stubGlobal('chrome', {
            storage: {
                local: {
                    get: () =>
                        Promise.resolve({ [StorageKeys.RECORDING_PAUSED_UNTIL]: FIXED_NOW + 60_000 }),
                },
            },
        });
        const { kernel, sender } = makeKernel({ pageState });
        try {
            await kernel.init();

            window.dispatchEvent(new Event('beforeunload'));

            expect(sender.sendMessageWithRetry).not.toHaveBeenCalledWith(
                expect.objectContaining({ type: 'RECORDING_SKIP_REASON' }),
            );
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('records nothing when the visit gate opened but the send failed (transport failure, not a condition skip)', async () => {
        const pageState = new PageState();
        pageState.startTime = FIXED_NOW - 3000;
        pageState.visitReportAttempted = true; // the gate opened — a failed send is not a condition skip
        const { kernel, sender } = makeKernel({ pageState });
        await kernel.init();

        window.dispatchEvent(new Event('beforeunload'));

        expect(sender.sendMessageWithRetry).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'RECORDING_SKIP_REASON' }),
        );
    });

    it('marks the attempt when the visit gate opens (reportValidVisit)', async () => {
        const pageState = new PageState();
        pageState.startTime = FIXED_NOW - 6000; // above the threshold
        pageState.maxScrollPercentage = 60;
        Object.defineProperty(window, 'scrollY', { value: 720, writable: true, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: 400, writable: true, configurable: true });
        Object.defineProperty(document.documentElement, 'scrollHeight', { value: 1600, writable: true, configurable: true });
        const reportSpy = vi.spyOn(pageState, 'visitReportAttempted', 'set');
        const { kernel } = makeKernel({ pageState });
        await kernel.init();

        kernel.updateMaxScroll();
        await Promise.resolve();
        await Promise.resolve();

        expect(reportSpy).toHaveBeenCalledWith(true);
    });
});
