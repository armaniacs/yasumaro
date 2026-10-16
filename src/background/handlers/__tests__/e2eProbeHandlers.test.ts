/**
 * Unit tests for the E2E probe relay handlers (PBI 2026-10-11-08 follow-up).
 * The service worker owns the session leg that content scripts cannot reach.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createE2EProbeQueryHandler, createE2EProbeStateHandler } from '../e2eProbeHandlers.js';
import type { OwE2eProbeQueryMessage, OwE2EProbeStateMessage } from '../../messageTypes.js';

const STATE = {
    maxScrollPercentage: 80,
    isValidVisitReported: false,
    startTime: 1000,
    minVisitDuration: 5,
    minScrollDepth: 50,
    duration: 2,
};

function stubSession(store: Record<string, unknown>) {
    const get = vi.fn((key?: string | string[] | null) => {
        if (typeof key === 'string') {
            return Promise.resolve(key in store ? { [key]: store[key] } : {});
        }
        return Promise.resolve({ ...store });
    });
    const set = vi.fn((items: Record<string, unknown>) => {
        Object.assign(store, items);
        return Promise.resolve();
    });
    vi.stubGlobal('chrome', { storage: { session: { get, set } } });
    return { get, set };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

async function runQuery(store: Record<string, unknown>): Promise<unknown> {
    stubSession(store);
    const handler = createE2EProbeQueryHandler();
    const sendResponse = vi.fn();
    const message: OwE2eProbeQueryMessage = { type: 'OW_PROBE_QUERY' };
    await handler(message, {} as chrome.runtime.MessageSender, sendResponse);
    return sendResponse.mock.calls[0]?.[0];
}

async function runState(
    store: Record<string, unknown>,
): Promise<{ response: unknown; set: ReturnType<typeof vi.fn> }> {
    const { set } = stubSession(store);
    const handler = createE2EProbeStateHandler();
    const sendResponse = vi.fn();
    const message: OwE2EProbeStateMessage = { type: 'OW_PROBE_STATE', payload: { ...STATE } };
    await handler(message, {} as chrome.runtime.MessageSender, sendResponse);
    return { response: sendResponse.mock.calls[0]?.[0], set };
}

describe('createE2EProbeQueryHandler', () => {
    it('answers enabled:true when the session flag is set', async () => {
        await expect(runQuery({ owE2eProbeEnabled: true })).resolves.toEqual({
            success: true,
            enabled: true,
        });
    });

    it('answers enabled:false when the session flag is missing', async () => {
        await expect(runQuery({})).resolves.toEqual({ success: true, enabled: false });
    });
});

describe('createE2EProbeStateHandler', () => {
    it('persists the payload into session storage for the harness and acks', async () => {
        const store: Record<string, unknown> = { owE2eProbeEnabled: true };
        const { response, set } = await runState(store);
        expect(response).toEqual({ success: true });
        expect(set).toHaveBeenCalledWith({ owE2eTestState: STATE });
        expect(store['owE2eTestState']).toEqual(STATE);
    });

    it('refuses the write while the probe is disarmed (arming gate)', async () => {
        const store: Record<string, unknown> = {};
        const { response, set } = await runState(store);

        expect(response).toEqual({ success: false, error: 'E2E probe is not armed' });
        expect(set).not.toHaveBeenCalled();
        expect(store['owE2eTestState']).toBeUndefined();
    });

    it('treats a non-exactly-true armed flag as disarmed', async () => {
        for (const flag of [false, 'true', 1]) {
            const store: Record<string, unknown> = { owE2eProbeEnabled: flag };
            const { response, set } = await runState(store);

            expect(response).toEqual({ success: false, error: 'E2E probe is not armed' });
            expect(set).not.toHaveBeenCalled();
        }
    });
});
