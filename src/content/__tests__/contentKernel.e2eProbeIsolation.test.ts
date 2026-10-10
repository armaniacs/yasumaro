// @vitest-environment jsdom
/**
 * Isolation pin for the E2E probe (PBI 2026-10-11-08 NN08).
 *
 * The probe must be unreachable from page JS:
 * - a page-set `data-ow-e2e-test` attribute neither arms the probe nor
 *   produces any page-visible output;
 * - when armed extension-side, user settings and recording state reach only
 *   extension-side routes (isolated window global + session storage), never
 *   page-shared DOM.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ContentKernel } from '../contentKernel.js';
import { FakeScheduler } from './helpers/fakeScheduler.js';
import { InMemoryStoragePort } from '../../utils/storage/storagePort.js';
import { InMemoryDomainPolicyPort } from './helpers/inMemoryDomainPolicyPort.js';
import { PageState } from '../pageState.js';
import type { MessageSender } from '../visitReporter.js';
import { E2E_PROBE_ENABLE_KEY } from '../e2eTestState.js';

const BASE = 2_000_000;

function makeKernel(pageState: PageState, opts: { isE2ETest?: () => boolean } = {}) {
    const storage = new InMemoryStoragePort();
    const policy = new InMemoryDomainPolicyPort({}, () => BASE);
    const sender = { sendMessageWithRetry: vi.fn(() => Promise.resolve({ success: true })) };
    const kernel = new ContentKernel(storage, policy, () => BASE, new FakeScheduler(), {
        pageState,
        sender: sender as unknown as MessageSender,
        ...opts,
    });
    return kernel;
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
        const kernel = makeKernel(pageState);

        await kernel.init();
        kernel.checkVisitConditions();

        expect(window.__OW_TEST_STATE).toBeUndefined();
        expect(document.documentElement.getAttribute('data-ow-test-state')).toBeNull();
        expect(document.documentElement.outerHTML).not.toContain('minVisitDuration');
        expect(document.documentElement.outerHTML).not.toContain('isValidVisitReported');
    });

    it('an injected E2E decision publishes to the window global but never to DOM', async () => {
        const pageState = new PageState();
        pageState.startTime = BASE;
        pageState.maxScrollPercentage = 80;
        const kernel = makeKernel(pageState, { isE2ETest: () => true });

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
        expect(document.documentElement.getAttribute('data-ow-test-state')).toBeNull();
        expect(document.documentElement.outerHTML).not.toContain('minVisitDuration');
        expect(document.documentElement.outerHTML).not.toContain('maxScrollPercentage');
    });

    it('the session flag arms the probe without any page markup', async () => {
        const get = vi.fn(() => Promise.resolve({ [E2E_PROBE_ENABLE_KEY]: true }));
        const set = vi.fn(() => Promise.resolve());
        vi.stubGlobal('chrome', { storage: { session: { get, set } } });

        const pageState = new PageState();
        pageState.startTime = BASE;
        pageState.maxScrollPercentage = 80;
        const kernel = makeKernel(pageState);

        await kernel.init();
        kernel.checkVisitConditions();

        expect(get).toHaveBeenCalledWith(E2E_PROBE_ENABLE_KEY);
        expect(window.__OW_TEST_STATE).toBeDefined();
        expect(document.documentElement.getAttribute('data-ow-test-state')).toBeNull();
    });
});
