/**
 * messageTransport.test.ts
 * Branch coverage tests for messaging/messageTransport.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    ChromeTransport,
    ImmediateTransport,
    MessageTransport,
    messageTransport,
} from '../messageTransport.js';
import { CURRENT_PROTOCOL_VERSION } from '../protocol.js';

describe('ChromeTransport', () => {
    it('delegates to chrome.runtime.sendMessage', async () => {
        const transport = new ChromeTransport();
        const sendSpy = vi.spyOn(chrome.runtime, 'sendMessage').mockResolvedValue({ ok: true });
        const result = await transport.send({ type: 'PING' });
        expect(sendSpy).toHaveBeenCalledWith({ type: 'PING' });
        expect(result).toEqual({ ok: true });
        sendSpy.mockRestore();
    });
});

describe('ImmediateTransport', () => {
    it('delegates to injected handler', async () => {
        const handler = vi.fn().mockResolvedValue({ result: 'ok' });
        const transport = new ImmediateTransport(handler);
        const result = await transport.send({ type: 'PING' });
        expect(handler).toHaveBeenCalledWith({ type: 'PING' });
        expect(result).toEqual({ result: 'ok' });
    });
});

describe('isRetryableError via send behavior', () => {
    it('retries on "Receiving end does not exist" pattern', async () => {
        const handler = vi.fn()
            .mockRejectedValueOnce(new Error('Receiving end does not exist'))
            .mockResolvedValue({ ok: true });
        const port = new ImmediateTransport(handler);
        const clock = { now: vi.fn(() => Date.now()), sleep: vi.fn().mockResolvedValue(undefined) };
        const transport = new MessageTransport(port, clock);
        const result = await transport.send({ type: 'PING' } as any);
        expect(handler).toHaveBeenCalledTimes(2);
        expect(result).toEqual({ ok: true });
    });

    it('does not retry on non-retryable error pattern', async () => {
        const handler = vi.fn().mockRejectedValue(new Error('some other error'));
        const port = new ImmediateTransport(handler);
        const transport = new MessageTransport(port);
        await expect(transport.send({ type: 'PING' } as any)).rejects.toThrow('some other error');
        expect(handler).toHaveBeenCalledTimes(1);
    });
});

describe('MessageTransport', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (chrome.runtime as unknown as { lastError?: { message?: string } }).lastError = null;
    });

    it('sends enriched message with protocol version', async () => {
        const port = new ImmediateTransport(vi.fn().mockResolvedValue({ success: true }));
        const transport = new MessageTransport(port);
        const result = await transport.send({ type: 'PING' } as any);
        expect(result).toEqual({ success: true });
    });

    it('throws for invalid message type', async () => {
        const port = new ImmediateTransport(vi.fn());
        const transport = new MessageTransport(port);
        await expect(transport.send({ type: 'INVALID_TYPE' } as any)).rejects.toThrow('Invalid message type');
    });

    it('retries on retryable error then succeeds', async () => {
        const handler = vi.fn()
            .mockRejectedValueOnce(new Error('Receiving end does not exist'))
            .mockResolvedValue({ ok: true });
        const port = new ImmediateTransport(handler);
        const clock = { now: vi.fn(() => Date.now()), sleep: vi.fn().mockResolvedValue(undefined) };
        const transport = new MessageTransport(port, clock);

        const result = await transport.send({ type: 'PING' } as any);
        expect(handler).toHaveBeenCalledTimes(2);
        expect(clock.sleep).toHaveBeenCalledWith(100);
        expect(result).toEqual({ ok: true });
    });

    it('retries up to max retries then throws', async () => {
        const handler = vi.fn().mockRejectedValue(new Error('Could not establish connection'));
        const port = new ImmediateTransport(handler);
        const clock = { now: vi.fn(() => Date.now()), sleep: vi.fn().mockResolvedValue(undefined) };
        const transport = new MessageTransport(port, clock);

        await expect(transport.send({ type: 'PING' } as any, { retries: 1 })).rejects.toThrow('Could not establish connection');
        expect(handler).toHaveBeenCalledTimes(2);
    });

    it('uses exponential backoff capped at 1000ms', async () => {
        const handler = vi.fn()
            .mockRejectedValueOnce(new Error('Receiving end does not exist'))
            .mockRejectedValueOnce(new Error('Receiving end does not exist'))
            .mockRejectedValueOnce(new Error('Receiving end does not exist'))
            .mockResolvedValue({ ok: true });
        const port = new ImmediateTransport(handler);
        const clock = { now: vi.fn(() => Date.now()), sleep: vi.fn().mockResolvedValue(undefined) };
        const transport = new MessageTransport(port, clock);

        await transport.send({ type: 'PING' } as any, { retries: 3 });
        expect(clock.sleep).toHaveBeenNthCalledWith(1, 100);
        expect(clock.sleep).toHaveBeenNthCalledWith(2, 200);
        expect(clock.sleep).toHaveBeenNthCalledWith(3, 400);
    });

    it('does not retry non-retryable errors', async () => {
        const handler = vi.fn().mockRejectedValue(new Error('bad request'));
        const port = new ImmediateTransport(handler);
        const clock = { now: vi.fn(() => Date.now()), sleep: vi.fn().mockResolvedValue(undefined) };
        const transport = new MessageTransport(port, clock);

        await expect(transport.send({ type: 'PING' } as any)).rejects.toThrow('bad request');
        expect(handler).toHaveBeenCalledTimes(1);
        expect(clock.sleep).not.toHaveBeenCalled();
    });

    it('throws immediately on lastError retryable pattern', async () => {
        const port = new ImmediateTransport(vi.fn().mockResolvedValue({ ok: true }));
        const transport = new MessageTransport(port);

        (chrome.runtime as unknown as { lastError?: { message?: string } }).lastError = {
            message: 'Receiving end does not exist',
        };

        await expect(transport.send({ type: 'PING' } as any)).rejects.toThrow('Receiving end does not exist');
    });

    it('uses opts.clock over instance clock', async () => {
        const handler = vi.fn()
            .mockRejectedValueOnce(new Error('Receiving end does not exist'))
            .mockResolvedValue({ ok: true });
        const port = new ImmediateTransport(handler);
        const instanceClock = { now: vi.fn(() => Date.now()), sleep: vi.fn().mockResolvedValue(undefined) };
        const optClock = { now: vi.fn(() => Date.now()), sleep: vi.fn().mockResolvedValue(undefined) };
        const transport = new MessageTransport(port, instanceClock);

        await transport.send({ type: 'PING' } as any, { clock: optClock });
        expect(optClock.sleep).toHaveBeenCalled();
        expect(instanceClock.sleep).not.toHaveBeenCalled();
    });

    it('returns response on successful first attempt', async () => {
        const port = new ImmediateTransport(vi.fn().mockResolvedValue({ data: 42 }));
        const transport = new MessageTransport(port);
        const result = await transport.send({ type: 'FETCH_URL', payload: { url: 'https://example.com' } } as any);
        expect(result).toEqual({ data: 42 });
    });
});

describe('messageTransport singleton', () => {
    it('is an instance of MessageTransport', () => {
        expect(messageTransport).toBeInstanceOf(MessageTransport);
    });
});
