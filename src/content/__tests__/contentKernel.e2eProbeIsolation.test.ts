// @vitest-environment jsdom
/**
 * Isolation pin for the E2E probe (PBI 2026-10-11-08 NN08, relay follow-up).
 *
 * The probe must be unreachable from page JS:
 * - a page-set `data-ow-e2e-test` attribute neither arms the probe nor
 *   produces any page-visible output;
 * - when armed extension-side (service worker relay), user settings and
 *   recording state reach only extension-side routes (isolated window global
 *   + SW-owned session storage), never page-shared DOM.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ContentKernel } from '../contentKernel.js';
import { FakeScheduler } from './helpers/fakeScheduler.js';
import { InMemoryStoragePort } from '../../utils/storage/storagePort.js';
import { InMemoryDomainPolicyPort } from './helpers/inMemoryDomainPolicyPort.js';
import { PageState } from '../pageState.js';
import type { MessageSender } from '../visitReporter.js';

const BASE = 2_000_000;

function makeKernel(
    pageState: PageState,
    opts: { isE2ETest?: () => boolean; senderResponse?: unknown } = {},
) {
    const storage = new InMemoryStoragePort();
    const policy = new InMemoryDomainPolicyPort({}, () => BASE);
    const sender = {
        sendMessageWithRetry: vi.fn(
            (_message: { type: string }): Promise<unknown> =>
                Promise.resolve(opts.senderResponse ?? { success: true }),
        ),
    };
    const kernel = new ContentKernel(storage, policy, () => BASE, new FakeScheduler(), {
        pageState,
        sender: sender as unknown as MessageSender,
        ...(opts.isE2ETest !== undefined ? { isE2ETest: opts.isE2ETest } : {}),
    });
    return { kernel, sender };
}

afterEach(() => {
    delete (window as unknown as { __OW_TEST_STATE?: unknown }).__OW_TEST_STATE;
    document.documentElement.removeAttribute('data-ow-e2e-test');
    document.documentElement.removeAttribute('data-ow-test-state');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('E2E probe isolation (NN08)', () => {
    it('a page-set data-ow-e2e-test attribute does not arm the probe', async () => {
        document.documentElement.setAttribute('data-ow-e2e-test', 'true');
        const pageState = new PageState();
        pageState.startTime = BASE;
        pageState.maxScrollPercentage = 80;
        const { kernel, sender } = makeKernel(pageState);

        await kernel.init();
        kernel.checkVisitConditions();

        // No arming query response enables the probe: the only message is the
        // query itself (answered disarmed), never a state report.
        expect(sender.sendMessageWithRetry).toHaveBeenCalledTimes(1);
        expect(sender.sendMessageWithRetry).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'OW_PROBE_QUERY' }),
        );
        expect(window.__OW_TEST_STATE).toBeUndefined();
        expect(document.documentElement.getAttribute('data-ow-test-state')).toBeNull();
        expect(document.documentElement.outerHTML).not.toContain('minVisitDuration');
        expect(document.documentElement.outerHTML).not.toContain('isValidVisitReported');
    });

    it('an injected E2E decision publishes to the window global but never to DOM', async () => {
        const pageState = new PageState();
        pageState.startTime = BASE;
        pageState.maxScrollPercentage = 80;
        const { kernel, sender } = makeKernel(pageState, { isE2ETest: () => true });

        await kernel.init();
        kernel.checkVisitConditions();

        expect(window.__OW_TEST_STATE).toEqual({
            maxScrollPercentage: 80,
            isValidVisitReported: false,
            startTime: BASE,
            minVisitDuration: 5,
            minScrollDepth: 50,
            duration: 0,
        });
        expect(sender.sendMessageWithRetry).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'OW_PROBE_STATE' }),
        );
        expect(document.documentElement.getAttribute('data-ow-test-state')).toBeNull();
        expect(document.documentElement.outerHTML).not.toContain('minVisitDuration');
        expect(document.documentElement.outerHTML).not.toContain('maxScrollPercentage');
    });

    it('the service worker relay arms the probe without any page markup', async () => {
        const pageState = new PageState();
        pageState.startTime = BASE;
        pageState.maxScrollPercentage = 80;
        const { kernel, sender } = makeKernel(pageState, {
            senderResponse: { success: true, enabled: true },
        });

        await kernel.init();
        kernel.checkVisitConditions();

        expect(sender.sendMessageWithRetry).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'OW_PROBE_QUERY' }),
        );
        expect(window.__OW_TEST_STATE).toBeDefined();
        expect(sender.sendMessageWithRetry).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'OW_PROBE_STATE' }),
        );
        expect(document.documentElement.getAttribute('data-ow-test-state')).toBeNull();
    });

    it('a failing relay query leaves the probe disarmed', async () => {
        const pageState = new PageState();
        pageState.startTime = BASE;
        pageState.maxScrollPercentage = 80;
        const { kernel, sender } = makeKernel(pageState, {
            senderResponse: Promise.reject(new Error('SW unreachable')),
        });

        await kernel.init();
        kernel.checkVisitConditions();

        const types = sender.sendMessageWithRetry.mock.calls.map((c) => (c[0] as { type: string }).type);
        expect(types).toEqual(['OW_PROBE_QUERY']);
        expect(window.__OW_TEST_STATE).toBeUndefined();
        expect(document.documentElement.getAttribute('data-ow-test-state')).toBeNull();
    });
});
