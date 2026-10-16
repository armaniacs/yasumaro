// @vitest-environment jsdom
/**
 * Unit tests for the E2E probe relay (PBI 2026-10-11-08 follow-up).
 * The relay carries arming queries and state reports as runtime messages
 * because content scripts cannot reach chrome.storage.session.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { queryProbeArmed, relayProbeState, markProbeVisitReported } from '../e2eProbeRelay.js';
import type { MessageSender } from '../visitReporter.js';
import type { OWTestState } from '../../utils/e2eTestState.js';

const STATE: OWTestState = {
    maxScrollPercentage: 80,
    isValidVisitReported: false,
    startTime: 1000,
    minVisitDuration: 5,
    minScrollDepth: 50,
    duration: 2,
};

function makeSender(response: unknown): { sender: MessageSender; send: ReturnType<typeof vi.fn> } {
    const send =
        response instanceof Error
            ? vi.fn(() => Promise.reject(response))
            : vi.fn(() => Promise.resolve(response));
    return { sender: { sendMessageWithRetry: send } as unknown as MessageSender, send };
}

afterEach(() => {
    delete (window as unknown as { __OW_TEST_STATE?: unknown }).__OW_TEST_STATE;
});

describe('queryProbeArmed', () => {
    it('resolves true only on success:true with enabled:true', async () => {
        const { sender } = makeSender({ success: true, enabled: true });
        await expect(queryProbeArmed(sender)).resolves.toBe(true);
    });

    it('resolves false when enabled is missing, false, or success is false', async () => {
        for (const response of [
            { success: true },
            { success: true, enabled: false },
            { success: false, enabled: true },
            undefined,
        ]) {
            const { sender } = makeSender(response);
            await expect(queryProbeArmed(sender)).resolves.toBe(false);
        }
    });

    it('resolves false when the transport throws (fail-safe)', async () => {
        const { sender } = makeSender(new Error('SW unreachable'));
        await expect(queryProbeArmed(sender)).resolves.toBe(false);
    });

    it('sends the query type without payload', async () => {
        const { sender, send } = makeSender({ success: true, enabled: true });
        await queryProbeArmed(sender);
        expect(send).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith({ type: 'OW_PROBE_QUERY' });
    });
});

describe('relayProbeState', () => {
    it('writes the isolated window global and sends the state type with payload', () => {
        const { sender, send } = makeSender({ success: true });
        relayProbeState(sender, STATE);
        expect(window.__OW_TEST_STATE).toBe(STATE);
        expect(send).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith({ type: 'OW_PROBE_STATE', payload: STATE });
        expect(document.documentElement.getAttribute('data-ow-test-state')).toBeNull();
    });

    it('still writes the window global when the send rejects, without throwing', () => {
        const { sender } = makeSender(new Error('SW unreachable'));
        expect(() => relayProbeState(sender, STATE)).not.toThrow();
        expect(window.__OW_TEST_STATE).toBe(STATE);
    });
});

describe('markProbeVisitReported', () => {
    it('sets the reported flag and relays the same object', () => {
        const { sender, send } = makeSender({ success: true });
        window.__OW_TEST_STATE = { ...STATE };
        markProbeVisitReported(sender);
        expect(window.__OW_TEST_STATE?.isValidVisitReported).toBe(true);
        expect(send).toHaveBeenCalledWith({
            type: 'OW_PROBE_STATE',
            payload: expect.objectContaining({ isValidVisitReported: true }),
        });
    });

    it('sends nothing when no window state exists', () => {
        const { sender, send } = makeSender({ success: true });
        markProbeVisitReported(sender);
        expect(send).not.toHaveBeenCalled();
    });
});
