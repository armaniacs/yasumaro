// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleOffscreenMessage } from '../offscreen.js';

const noop = () => {};

function makeMessage(type: string, payload?: Record<string, unknown>) {
    return { target: 'offscreen', type, payload };
}

describe('handleOffscreenMessage - routing', () => {
    it('ignores non-object messages', () => {
        const result = handleOffscreenMessage('string', {} as chrome.runtime.MessageSender, noop);
        expect(result).toBe(false);
    });

    it('ignores null messages', () => {
        const result = handleOffscreenMessage(null, {} as chrome.runtime.MessageSender, noop);
        expect(result).toBe(false);
    });

    it('ignores messages without target field', () => {
        const result = handleOffscreenMessage({ type: 'CHECK_AVAILABILITY' }, {} as chrome.runtime.MessageSender, noop);
        expect(result).toBe(false);
    });

    it('ignores messages targeted at other components', () => {
        const result = handleOffscreenMessage(
            { target: 'background', type: 'CHECK_AVAILABILITY' },
            {} as chrome.runtime.MessageSender,
            noop
        );
        expect(result).toBe(false);
    });

    it('returns true for offscreen-targeted messages to keep channel open', () => {
        const result = handleOffscreenMessage(
            makeMessage('CHECK_AVAILABILITY'),
            {} as chrome.runtime.MessageSender,
            noop
        );
        expect(result).toBe(true);
    });
});

describe('handleOffscreenMessage - CHECK_AVAILABILITY', () => {
    beforeEach(() => {
        Object.defineProperty(window, 'ai', { value: undefined, writable: true, configurable: true });
    });

    it('responds with "unsupported" when window.ai is not available', async () => {
        const responses: unknown[] = [];
        handleOffscreenMessage(
            makeMessage('CHECK_AVAILABILITY'),
            {} as chrome.runtime.MessageSender,
            (r) => responses.push(r)
        );
        await vi.waitFor(() => expect(responses.length).toBe(1));
        expect((responses[0] as { status: string }).status).toBe('unsupported');
    });

    it('responds with availability status when window.ai is available', async () => {
        const mockAi = {
            languageModel: {
                capabilities: vi.fn().mockResolvedValue({ available: 'readily' }),
                create: vi.fn(),
            },
        };
        Object.defineProperty(window, 'ai', { value: mockAi, writable: true, configurable: true });

        const responses: unknown[] = [];
        handleOffscreenMessage(
            makeMessage('CHECK_AVAILABILITY'),
            {} as chrome.runtime.MessageSender,
            (r) => responses.push(r)
        );
        await vi.waitFor(() => expect(responses.length).toBe(1));
        expect((responses[0] as { status: string }).status).toBe('readily');
    });

    it('responds with "unsupported" when capabilities() throws', async () => {
        const mockAi = {
            languageModel: {
                capabilities: vi.fn().mockRejectedValue(new Error('caps error')),
                create: vi.fn(),
            },
        };
        Object.defineProperty(window, 'ai', { value: mockAi, writable: true, configurable: true });

        const responses: unknown[] = [];
        handleOffscreenMessage(
            makeMessage('CHECK_AVAILABILITY'),
            {} as chrome.runtime.MessageSender,
            (r) => responses.push(r)
        );
        await vi.waitFor(() => expect(responses.length).toBe(1));
        expect((responses[0] as { status: string }).status).toBe('unsupported');
    });
});

describe('handleOffscreenMessage - SUMMARIZE', () => {
    beforeEach(() => {
        Object.defineProperty(window, 'ai', { value: undefined, writable: true, configurable: true });
    });

    it('returns error when no content provided', async () => {
        const responses: unknown[] = [];
        handleOffscreenMessage(
            makeMessage('SUMMARIZE', {}),
            {} as chrome.runtime.MessageSender,
            (r) => responses.push(r)
        );
        await vi.waitFor(() => expect(responses.length).toBe(1));
        const resp = responses[0] as { success: boolean; error: string };
        expect(resp.success).toBe(false);
        expect(resp.error).toBe('No content provided');
    });

    it('returns error when ai is not available for session', async () => {
        const responses: unknown[] = [];
        handleOffscreenMessage(
            makeMessage('SUMMARIZE', { content: 'test content' }),
            {} as chrome.runtime.MessageSender,
            (r) => responses.push(r)
        );
        await vi.waitFor(() => expect(responses.length).toBe(1));
        const resp = responses[0] as { success: boolean; error: string };
        expect(resp.success).toBe(false);
        expect(resp.error).toContain("'ai' object not found");
    });

    it('returns error when ai status is not ready', async () => {
        const mockAi = {
            languageModel: {
                capabilities: vi.fn().mockResolvedValue({ available: 'no' }),
                create: vi.fn(),
            },
        };
        Object.defineProperty(window, 'ai', { value: mockAi, writable: true, configurable: true });

        const responses: unknown[] = [];
        handleOffscreenMessage(
            makeMessage('SUMMARIZE', { content: 'test content' }),
            {} as chrome.runtime.MessageSender,
            (r) => responses.push(r)
        );
        await vi.waitFor(() => expect(responses.length).toBe(1));
        const resp = responses[0] as { success: boolean; error: string };
        expect(resp.success).toBe(false);
        expect(resp.error).toContain("'no'");
    });

    it('returns success with summary when session prompts successfully', async () => {
        const mockSession = {
            prompt: vi.fn().mockResolvedValue('AI summary result'),
            destroy: vi.fn(),
        };
        const mockAi = {
            languageModel: {
                capabilities: vi.fn().mockResolvedValue({ available: 'readily' }),
                create: vi.fn().mockResolvedValue(mockSession),
            },
        };
        Object.defineProperty(window, 'ai', { value: mockAi, writable: true, configurable: true });

        const responses: unknown[] = [];
        handleOffscreenMessage(
            makeMessage('SUMMARIZE', { content: 'page content to summarize' }),
            {} as chrome.runtime.MessageSender,
            (r) => responses.push(r)
        );
        await vi.waitFor(() => expect(responses.length).toBe(1));
        const resp = responses[0] as { success: boolean; summary: string };
        expect(resp.success).toBe(true);
        expect(resp.summary).toBe('AI summary result');
    });

    it('returns success for very long content (truncation path)', async () => {
        const mockAi = {
            languageModel: {
                capabilities: vi.fn().mockResolvedValue({ available: 'readily' }),
                create: vi.fn().mockResolvedValue({
                    prompt: vi.fn().mockResolvedValue('truncated summary'),
                    destroy: vi.fn(),
                }),
            },
        };
        Object.defineProperty(window, 'ai', { value: mockAi, writable: true, configurable: true });

        const longContent = 'x'.repeat(20000);
        const responses: unknown[] = [];
        handleOffscreenMessage(
            makeMessage('SUMMARIZE', { content: longContent }),
            {} as chrome.runtime.MessageSender,
            (r) => responses.push(r)
        );
        await vi.waitFor(() => expect(responses.length).toBe(1));
        const resp = responses[0] as { success: boolean };
        expect(resp.success).toBe(true);
    });
});

describe('handleOffscreenMessage - unknown type', () => {
    it('returns error for unknown message type', async () => {
        const responses: unknown[] = [];
        handleOffscreenMessage(
            makeMessage('UNKNOWN_TYPE'),
            {} as chrome.runtime.MessageSender,
            (r) => responses.push(r)
        );
        await vi.waitFor(() => expect(responses.length).toBe(1));
        const resp = responses[0] as { success: boolean; error: string };
        expect(resp.success).toBe(false);
        expect(resp.error).toBe('Unknown message type');
    });
});
