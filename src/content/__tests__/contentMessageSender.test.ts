/**
 * contentMessageSender.test.ts (PBI 2026-11-08-05)
 * The unload-path single-shot send: one immediate attempt, no retry/backoff
 * sleeps for a tearing-down page to outlive.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createContentMessageSender } from '../contentMessageSender.js';

function stubSendMessage(impl: (message: unknown) => Promise<unknown>) {
    const sendMessage = vi.fn(impl);
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    return sendMessage;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('createContentMessageSender', () => {
    describe('sendMessageWithRetry', () => {
        it('returns the service worker response on success', async () => {
            stubSendMessage(async () => ({ success: true }));
            const sender = createContentMessageSender();

            const response = await sender.sendMessageWithRetry({ type: 'VALID_VISIT' });

            expect(response).toEqual({ success: true });
        });
    });

    describe('sendMessageWithoutRetry', () => {
        it('sends exactly once even when the transport rejects retryably', async () => {
            const sendMessage = stubSendMessage(async () => {
                throw new Error('Receiving end does not exist');
            });
            const sender = createContentMessageSender();

            await expect(
                sender.sendMessageWithoutRetry?.({ type: 'RECORDING_SKIP_REASON' }),
            ).rejects.toThrow('Receiving end does not exist');
            expect(sendMessage).toHaveBeenCalledTimes(1);
        });

        it('returns the service worker response on success', async () => {
            stubSendMessage(async () => ({ success: true }));
            const sender = createContentMessageSender();

            const response = await sender.sendMessageWithoutRetry?.({
                type: 'RECORDING_SKIP_REASON',
            });

            expect(response).toEqual({ success: true });
        });

        it('returns undefined for a non-service-worker response shape', async () => {
            stubSendMessage(async () => ({ unexpected: 1 }));
            const sender = createContentMessageSender();

            const response = await sender.sendMessageWithoutRetry?.({
                type: 'RECORDING_SKIP_REASON',
            });

            expect(response).toBeUndefined();
        });
    });
});
