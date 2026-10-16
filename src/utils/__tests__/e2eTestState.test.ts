// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    publishE2eTestState,
    isE2EProbeEnabled,
    E2E_PROBE_ENABLE_KEY,
    E2E_PROBE_STATE_KEY,
    type OWTestState,
} from '../e2eTestState.js';

const STATE: OWTestState = {
    maxScrollPercentage: 42,
    isValidVisitReported: true,
    startTime: 1234,
    minVisitDuration: 7,
    minScrollDepth: 33,
    duration: 9.5,
};

afterEach(() => {
    delete (window as unknown as { __OW_TEST_STATE?: unknown }).__OW_TEST_STATE;
    document.documentElement.removeAttribute('data-ow-test-state');
    vi.unstubAllGlobals();
});

describe('publishE2eTestState', () => {
    it('writes the session leg and leaves the window global to the relay owner', () => {
        const set = vi.fn(() => Promise.resolve());
        vi.stubGlobal('chrome', { storage: { session: { set } } });

        publishE2eTestState(STATE);

        expect(set).toHaveBeenCalledTimes(1);
        expect(set).toHaveBeenCalledWith({ [E2E_PROBE_STATE_KEY]: STATE });
        // Single-owner split: the session leg is written here (service worker),
        // the window leg belongs to src/content/e2eProbeRelay.ts — pinned by
        // testDir/__tests__/e2eProbeContract.test.ts.
        expect(window.__OW_TEST_STATE).toBeUndefined();
    });

    it('never writes page-shared DOM (PBI NN08)', () => {
        publishE2eTestState(STATE);

        expect(document.documentElement.getAttribute('data-ow-test-state')).toBeNull();
        expect(document.documentElement.hasAttribute('data-ow-test-state')).toBe(false);
    });

    it('does not throw and does not touch the window when the session write rejects', async () => {
        const set = vi.fn(() => Promise.reject(new Error('quota')));
        vi.stubGlobal('chrome', { storage: { session: { set } } });

        expect(() => publishE2eTestState(STATE)).not.toThrow();
        expect(window.__OW_TEST_STATE).toBeUndefined();
        // Rejection is swallowed — flush microtasks to prove no unhandled rejection.
        await Promise.resolve();
    });

    it('is a no-op when session storage is unavailable, leaving the window untouched', () => {
        expect(() => publishE2eTestState(STATE)).not.toThrow();

        expect(window.__OW_TEST_STATE).toBeUndefined();
    });
});

describe('isE2EProbeEnabled', () => {
    it('is false without chrome (unit/jsdom, production page world)', async () => {
        await expect(isE2EProbeEnabled()).resolves.toBe(false);
    });

    it('is true when the session flag is set', async () => {
        const get = vi.fn(() => Promise.resolve({ [E2E_PROBE_ENABLE_KEY]: true }));
        vi.stubGlobal('chrome', { storage: { session: { get } } });

        await expect(isE2EProbeEnabled()).resolves.toBe(true);
        expect(get).toHaveBeenCalledWith(E2E_PROBE_ENABLE_KEY);
    });

    it('is false when the session flag is missing or not exactly true', async () => {
        for (const value of [{}, { [E2E_PROBE_ENABLE_KEY]: false }, { [E2E_PROBE_ENABLE_KEY]: 'true' }]) {
            const get = vi.fn(() => Promise.resolve(value));
            vi.stubGlobal('chrome', { storage: { session: { get } } });
            await expect(isE2EProbeEnabled()).resolves.toBe(false);
        }
    });

    it('is false when the session read rejects', async () => {
        const get = vi.fn(() => Promise.reject(new Error('denied')));
        vi.stubGlobal('chrome', { storage: { session: { get } } });

        await expect(isE2EProbeEnabled()).resolves.toBe(false);
    });
});
