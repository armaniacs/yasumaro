// @vitest-environment jsdom
/**
 * getContentHandler.test.ts (PBI-14)
 * handleGetContentMessage is chrome-free: no chrome global is stubbed in
 * this file, proving the handler is directly callable without
 * vi.resetModules() or onMessage.addListener pull-outs.
 */
import { describe, it, expect, vi } from 'vitest';
import { handleGetContentMessage, type GetContentHandlerDeps } from '../getContentHandler.js';
import { PageState } from '../pageState.js';
import type { ExtractResult } from '../../utils/contentExtractor/types.js';

function makeDeps(runtimeId: string | undefined = 'test-extension-id'): {
    deps: GetContentHandlerDeps;
    extractPageContent: ReturnType<typeof vi.fn>;
    applyExtractResultToPageState: ReturnType<typeof vi.fn>;
    pageState: PageState;
} {
    const pageState = new PageState();
    const extractPageContent = vi.fn(
        () =>
            ({
                content: '<p>hello</p>',
                cleansedReason: 'none',
            }) as ExtractResult,
    );
    const applyExtractResultToPageState = vi.fn();
    return {
        deps: { extractPageContent, applyExtractResultToPageState, pageState, runtimeId },
        extractPageContent,
        applyExtractResultToPageState,
        pageState,
    };
}

describe('handleGetContentMessage - chrome-free direct calls', () => {
    it('works even when no chrome global exists', () => {
        const holder = globalThis as unknown as Record<string, unknown>;
        const saved = holder['chrome'];
        try {
            delete holder['chrome'];
            const { deps } = makeDeps('test-extension-id');
            const sendResponse = vi.fn();
            handleGetContentMessage({ type: 'GET_CONTENT' }, { id: 'test-extension-id' }, sendResponse, deps);
            expect(sendResponse).toHaveBeenCalledTimes(1);
        } finally {
            holder['chrome'] = saved;
        }
    });

    it('ignores non-object / null / type-less messages', () => {
        const { deps } = makeDeps();
        for (const message of [undefined, null, 42, 'GET_CONTENT', {}, { type: 7 }]) {
            const sendResponse = vi.fn();
            const result = handleGetContentMessage(message, { id: 'test-extension-id' }, sendResponse, deps);
            expect(sendResponse).not.toHaveBeenCalled();
            expect(result).toBeUndefined();
        }
        expect(deps.extractPageContent).not.toHaveBeenCalled();
    });

    it('ignores non-GET_CONTENT broadcasts', () => {
        const { deps } = makeDeps();
        const sendResponse = vi.fn();
        const result = handleGetContentMessage(
            { type: 'AI_TEST_PROGRESS', progress: {} },
            { id: 'test-extension-id' },
            sendResponse,
            deps,
        );
        expect(sendResponse).not.toHaveBeenCalled();
        expect(result).toBeUndefined();
        expect(deps.extractPageContent).not.toHaveBeenCalled();
    });

    it('rejects senders whose id differs from runtimeId', () => {
        const { deps } = makeDeps('test-extension-id');
        const sendResponse = vi.fn();
        handleGetContentMessage({ type: 'GET_CONTENT' }, { id: 'external-id' }, sendResponse, deps);
        expect(sendResponse).not.toHaveBeenCalled();
        expect(deps.extractPageContent).not.toHaveBeenCalled();
    });

    it('answers same-extension GET_CONTENT with the full response shape', () => {
        const { deps, extractPageContent, applyExtractResultToPageState, pageState } = makeDeps('test-extension-id');
        const sendResponse = vi.fn();

        handleGetContentMessage({ type: 'GET_CONTENT' }, { id: 'test-extension-id' }, sendResponse, deps);

        expect(extractPageContent).toHaveBeenCalledTimes(1);
        expect(applyExtractResultToPageState).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledTimes(1);
        const response = sendResponse.mock.calls[0]![0] as Record<string, unknown>;
        expect(response).toHaveProperty('content', '<p>hello</p>');
        expect(response).toHaveProperty('cleansedReason', pageState.lastCleansedReason);
        expect(response).toHaveProperty('cleanseStats');
        expect(response).toHaveProperty('byteStats');
        expect(response).toHaveProperty('aiSummaryCleansedStats');
        expect(response).toHaveProperty('fallbackTriggered');
    });

    it('echoes injected pageState stats (no singleton coupling)', () => {
        const { deps, pageState } = makeDeps('test-extension-id');
        pageState.lastCleansedReason = 'keyword';
        pageState.lastCleanseStats = { hardStripRemoved: 1, keywordStripRemoved: 2, totalRemoved: 3 };
        const sendResponse = vi.fn();

        handleGetContentMessage({ type: 'GET_CONTENT' }, { id: 'test-extension-id' }, sendResponse, deps);

        const response = sendResponse.mock.calls[0]![0] as Record<string, unknown>;
        expect(response['cleansedReason']).toBe('keyword');
        expect(response['cleanseStats']).toEqual({ hardStripRemoved: 1, keywordStripRemoved: 2, totalRemoved: 3 });
    });
});
