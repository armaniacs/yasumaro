/**
 * messaging-types.test.ts
 * Tests for messaging/types.ts runtime type functions
 * Target: isMaskedItem, isServiceWorkerRequest, isSuccessResponse, isErrorResponse,
 *         extractMessageContent, sendServiceWorkerMessage, sendFromContentScript, sendFromPopup
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    isMaskedItem,
    isServiceWorkerRequest,
    isSuccessResponse,
    isErrorResponse,
    extractMessageContent,
    sendServiceWorkerMessage,
    sendFromContentScript,
    sendFromPopup,
} from '../types.js';
import { CURRENT_PROTOCOL_VERSION } from '../../background/messageTypes.js';

describe('messaging/types: isMaskedItem', () => {
    it('returns false for null', () => {
        expect(isMaskedItem(null)).toBe(false);
    });

    it('returns false for undefined', () => {
        expect(isMaskedItem(undefined)).toBe(false);
    });

    it('returns false for string', () => {
        expect(isMaskedItem('email')).toBe(false);
    });

    it('returns false for array', () => {
        expect(isMaskedItem([{ type: 'email' }])).toBe(false);
    });

    it('returns false when type property is missing', () => {
        expect(isMaskedItem({})).toBe(false);
    });

    it('returns false when type is not a string', () => {
        expect(isMaskedItem({ type: 123 })).toBe(false);
    });

    it('returns false for unknown type value', () => {
        expect(isMaskedItem({ type: 'unknown' })).toBe(false);
    });

    it('returns true for valid email type', () => {
        expect(isMaskedItem({ type: 'email' })).toBe(true);
    });

    it('returns true for valid creditCard type', () => {
        expect(isMaskedItem({ type: 'creditCard' })).toBe(true);
    });

    it('returns true for valid phoneJp type', () => {
        expect(isMaskedItem({ type: 'phoneJp' })).toBe(true);
    });

    it('returns true for valid myNumber type', () => {
        expect(isMaskedItem({ type: 'myNumber' })).toBe(true);
    });

    it('returns true for valid bankAccount type', () => {
        expect(isMaskedItem({ type: 'bankAccount' })).toBe(true);
    });

    it('returns true for valid price type', () => {
        expect(isMaskedItem({ type: 'price' })).toBe(true);
    });

    it('returns false when position is not a string', () => {
        expect(isMaskedItem({ type: 'email', position: 42 })).toBe(false);
    });

    it('returns true when position is a string', () => {
        expect(isMaskedItem({ type: 'email', position: 'header' })).toBe(true);
    });

    it('returns true when position is undefined', () => {
        expect(isMaskedItem({ type: 'email', position: undefined })).toBe(true);
    });

    it('returns false when original is not a string', () => {
        expect(isMaskedItem({ type: 'email', original: 42 })).toBe(false);
    });

    it('returns true when original is a string', () => {
        expect(isMaskedItem({ type: 'email', original: 'test@test.com' })).toBe(true);
    });

    it('returns false when index is not a number', () => {
        expect(isMaskedItem({ type: 'email', index: '0' })).toBe(false);
    });

    it('returns true when index is a number', () => {
        expect(isMaskedItem({ type: 'email', index: 0 })).toBe(true);
    });

    it('returns true for fully populated MaskedItem', () => {
        const item = {
            type: 'email',
            position: 'body',
            original: 'foo@bar.com',
            index: 3,
        };
        expect(isMaskedItem(item)).toBe(true);
    });
});

describe('messaging/types: isServiceWorkerRequest', () => {
    it('returns false for null', () => {
        expect(isServiceWorkerRequest(null)).toBe(false);
    });

    it('returns false for undefined', () => {
        expect(isServiceWorkerRequest(undefined)).toBe(false);
    });

    it('returns false for string', () => {
        expect(isServiceWorkerRequest('hello')).toBe(false);
    });

    it('returns false when type is missing', () => {
        expect(isServiceWorkerRequest({})).toBe(false);
    });

    it('returns false for unknown type', () => {
        expect(isServiceWorkerRequest({ type: 'UNKNOWN' })).toBe(false);
    });

    it('returns false for no-payload type with object payload', () => {
        expect(isServiceWorkerRequest({ type: 'CHECK_DOMAIN', payload: {} })).toBe(false);
    });

    it('returns false for no-payload type with string payload', () => {
        expect(isServiceWorkerRequest({ type: 'GET_CONTENT', payload: 'x' })).toBe(false);
    });

    it('returns true for no-payload type with undefined payload', () => {
        expect(isServiceWorkerRequest({ type: 'SAVE_RECORD', payload: undefined })).toBe(true);
    });

    it('returns true for no-payload type without payload property', () => {
        expect(isServiceWorkerRequest({ type: 'TEST_CONNECTIONS' })).toBe(true);
    });

    it('returns true for VALID_VISIT with object payload', () => {
        expect(isServiceWorkerRequest({ type: 'VALID_VISIT', payload: { content: 'hi' } })).toBe(true);
    });

    it('returns false for VALID_VISIT with undefined payload', () => {
        expect(isServiceWorkerRequest({ type: 'VALID_VISIT', payload: undefined })).toBe(false);
    });

    it('returns false for VALID_VISIT with string payload', () => {
        expect(isServiceWorkerRequest({ type: 'VALID_VISIT', payload: 'hi' })).toBe(false);
    });

    it('returns true for FETCH_URL with object payload', () => {
        expect(isServiceWorkerRequest({ type: 'FETCH_URL', payload: { url: 'https://example.com' } })).toBe(true);
    });

    it('returns true for MANUAL_RECORD with object payload', () => {
        expect(isServiceWorkerRequest({ type: 'MANUAL_RECORD', payload: { title: 't', url: 'u', content: 'c' } })).toBe(true);
    });

    it('returns true for PREVIEW_RECORD with object payload', () => {
        expect(isServiceWorkerRequest({ type: 'PREVIEW_RECORD', payload: { title: 't', url: 'u', content: 'c' } })).toBe(true);
    });

    it('returns true for CONTENT_CLEANSING_EXECUTED with object payload', () => {
        expect(isServiceWorkerRequest({ type: 'CONTENT_CLEANSING_EXECUTED', payload: { hardStripRemoved: 1 } })).toBe(true);
    });

    it('handles all no-payload types correctly', () => {
        const noPayloadTypes = [
            'CHECK_DOMAIN', 'GET_CONTENT', 'SAVE_RECORD',
            'TEST_CONNECTIONS', 'TEST_OBSIDIAN', 'TEST_AI',
            'GET_PRIVACY_CACHE', 'ACTIVITY_UPDATE', 'SESSION_LOCK_REQUEST',
        ];
        noPayloadTypes.forEach((type) => {
            expect(isServiceWorkerRequest({ type })).toBe(true);
            expect(isServiceWorkerRequest({ type, payload: {} })).toBe(false);
        });
    });
});

describe('messaging/types: isSuccessResponse', () => {
    it('returns false for null', () => {
        expect(isSuccessResponse(null)).toBe(false);
    });

    it('returns false for undefined', () => {
        expect(isSuccessResponse(undefined)).toBe(false);
    });

    it('returns false for string', () => {
        expect(isSuccessResponse('success')).toBe(false);
    });

    it('returns false when success property is missing', () => {
        expect(isSuccessResponse({ data: 'x' })).toBe(false);
    });

    it('returns false when success is false', () => {
        expect(isSuccessResponse({ success: false })).toBe(false);
    });

    it('returns true when success is true', () => {
        expect(isSuccessResponse({ success: true })).toBe(true);
    });

    it('returns true for object with success true and extra properties', () => {
        expect(isSuccessResponse({ success: true, data: 'extra' })).toBe(true);
    });
});

describe('messaging/types: isErrorResponse', () => {
    it('returns false for null', () => {
        expect(isErrorResponse(null)).toBe(false);
    });

    it('returns false for undefined', () => {
        expect(isErrorResponse(undefined)).toBe(false);
    });

    it('returns false for string', () => {
        expect(isErrorResponse('error')).toBe(false);
    });

    it('returns false when success property is missing', () => {
        expect(isErrorResponse({ error: 'oops' })).toBe(false);
    });

    it('returns false when success is true', () => {
        expect(isErrorResponse({ success: true })).toBe(false);
    });

    it('returns true when success is false', () => {
        expect(isErrorResponse({ success: false, error: 'oops' })).toBe(true);
    });

    it('returns true for object with success false and extra properties', () => {
        expect(isErrorResponse({ success: false, code: 500 })).toBe(true);
    });
});

describe('messaging/types: extractMessageContent', () => {
    it('extracts tabId and tabUrl from sender with tab', () => {
        const sender = {
            tab: { id: 42, url: 'https://example.com' },
        } as chrome.runtime.MessageSender;

        const result = extractMessageContent(sender);

        expect(result.tabId).toBe(42);
        expect(result.tabUrl).toBe('https://example.com');
        expect(result.isValidSender).toBe(true);
    });

    it('allows popup sender without tab', () => {
        const sender = {} as chrome.runtime.MessageSender;

        const result = extractMessageContent(sender);

        expect(result.tabId).toBeUndefined();
        expect(result.tabUrl).toBeUndefined();
        expect(result.isValidSender).toBe(true);
    });

    it('allows sender with tab but no id', () => {
        const sender = { tab: { url: 'https://example.com' } } as unknown as chrome.runtime.MessageSender;

        const result = extractMessageContent(sender);

        expect(result.tabId).toBeUndefined();
        expect(result.tabUrl).toBe('https://example.com');
        expect(result.isValidSender).toBe(true);
    });
});

describe('messaging/types: sendServiceWorkerMessage', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('returns response on success', async () => {
        const response = { success: true, data: 'ok' };
        (globalThis as any).chrome.runtime.sendMessage = vi.fn().mockResolvedValue(response);

        const result = await sendServiceWorkerMessage('VALID_VISIT', { content: 'hi' });
        expect(result).toEqual(response);
    });

    it('throws on error response', async () => {
        (globalThis as any).chrome.runtime.sendMessage = vi.fn().mockResolvedValue({ success: false, error: 'fail' });

        await expect(sendServiceWorkerMessage('CHECK_DOMAIN')).rejects.toThrow('fail');
    });

    it('throws on error response for fetch', async () => {
        (globalThis as any).chrome.runtime.sendMessage = vi.fn().mockResolvedValue({ success: false, error: 'timeout' });

        await expect(sendServiceWorkerMessage('FETCH_URL', { url: 'https://ex.com' })).rejects.toThrow('timeout');
    });
});

describe('messaging/types: sendFromContentScript', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('delegates to sendServiceWorkerMessage', async () => {
        const response = { success: true, summary: 'test' };
        (globalThis as any).chrome.runtime.sendMessage = vi.fn().mockResolvedValue(response);

        const result = await sendFromContentScript('VALID_VISIT', { content: 'hello' });
        expect(result).toEqual(response);
    });
});

describe('messaging/types: sendFromPopup', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('sends message without payload when payload is undefined', async () => {
        const sendMessageMock = vi.fn().mockResolvedValue({ success: true });
        (globalThis as any).chrome.runtime.sendMessage = sendMessageMock;

        await sendFromPopup('TEST_CONNECTIONS');
        expect(sendMessageMock).toHaveBeenCalledWith({ type: 'TEST_CONNECTIONS', protocolVersion: CURRENT_PROTOCOL_VERSION });
    });

    it('sends message with payload when provided', async () => {
        const sendMessageMock = vi.fn().mockResolvedValue({ success: true });
        (globalThis as any).chrome.runtime.sendMessage = sendMessageMock;

        await sendFromPopup('VALID_VISIT', { content: 'hi' });
        expect(sendMessageMock).toHaveBeenCalledWith({ type: 'VALID_VISIT', payload: { content: 'hi' }, protocolVersion: CURRENT_PROTOCOL_VERSION });
    });

    it('throws on error response', async () => {
        (globalThis as any).chrome.runtime.sendMessage = vi.fn().mockResolvedValue({ success: false, error: 'popup error' });

        await expect(sendFromPopup('TEST_OBSIDIAN')).rejects.toThrow('popup error');
    });
});
