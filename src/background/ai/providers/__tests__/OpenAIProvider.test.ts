/**
 * OpenAIProvider.test.ts
 * OpenAIProvider の文字数切り詰め・設定値テスト
 */

import { vi, describe, test, expect, beforeEach } from 'vitest';
import { OpenAIProvider } from '../OpenAIProvider.js';
import { StorageKeys } from '../../../../utils/storage.js';

const mockFetchWithRetry = vi.fn();
vi.mock('../../../../utils/fetch.js', () => ({
    fetchWithRetry: (...args: any[]) => mockFetchWithRetry(...args),
    validateUrlForAIRequests: () => undefined
}));

vi.mock('../../../../utils/logger.js', () => ({
    addLog: vi.fn(),
    LogType: { WARN: 'warn', ERROR: 'error', INFO: 'info', DEBUG: 'debug' }
}));

vi.mock('../../../../utils/aiUsageTracker.js', () => ({
    checkHardLimit: vi.fn(async () => ({ blocked: false })),
    checkUsageWarning: vi.fn(async () => ({ warning: false })),
    checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 9, resetTime: Date.now() + 60000 })),
    getRateLimitMessage: vi.fn(() => 'Rate limit exceeded')
}));

vi.mock('../../../../utils/promptSanitizer.js', () => ({
    sanitizePromptContent: (content: string) => ({ sanitized: content, warnings: [], dangerLevel: 'low' })
}));

vi.mock('../../../../utils/customPromptUtils.js', () => ({
    applyCustomPrompt: (_settings: any, _providerName: string, content: string) => ({
        userPrompt: `Content:\n${content}`,
        systemPrompt: 'system'
    })
}));

vi.mock('../../../../utils/storage.js', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../../../utils/storage.js')>();
    return {
        ...original,
        getAllowedUrls: vi.fn(async () => new Set<string>())
    };
});

function createResponse(body: object): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
}

describe('OpenAIProvider', () => {
    beforeEach(() => {
        mockFetchWithRetry.mockReset();
    });

    describe('content length truncation', () => {
        test('デフォルトで 10,000 文字に切り詰める', async () => {
            mockFetchWithRetry.mockResolvedValue(createResponse({
                choices: [{ message: { content: 'summary' } }],
                usage: { prompt_tokens: 1, completion_tokens: 1 }
            }));

            const settings = {
                openai_base_url: 'https://api.openai.com/v1',
                openai_api_key: 'test-key',
                openai_model: 'gpt-4o-mini'
            } as any;
            const provider = new OpenAIProvider(settings);
            const longContent = 'a'.repeat(20_000);

            await provider.generateSummary(longContent);

            const body = JSON.parse(mockFetchWithRetry.mock.calls[0][1].body);
            const userContent = body.messages[1].content;
            const contentMatch = userContent.match(/Content:\n([\s\S]*)$/);
            const actualContent = contentMatch ? contentMatch[1] : '';
            expect(actualContent.length).toBe(10_000);
        });

        test('openai_content_chars 設定で切り詰め文字数を上書きする', async () => {
            mockFetchWithRetry.mockResolvedValue(createResponse({
                choices: [{ message: { content: 'summary' } }],
                usage: { prompt_tokens: 1, completion_tokens: 1 }
            }));

            const settings = {
                openai_base_url: 'https://api.openai.com/v1',
                openai_api_key: 'test-key',
                openai_model: 'gpt-4o-mini',
                [StorageKeys.OPENAI_CONTENT_CHARS]: 15000
            } as any;
            const provider = new OpenAIProvider(settings);
            const longContent = 'b'.repeat(20_000);

            await provider.generateSummary(longContent);

            const body = JSON.parse(mockFetchWithRetry.mock.calls[0][1].body);
            const userContent = body.messages[1].content;
            const contentMatch = userContent.match(/Content:\n([\s\S]*)$/);
            const actualContent = contentMatch ? contentMatch[1] : '';
            expect(actualContent.length).toBe(15_000);
        });

        test('ローカル URL の場合は 4,000 文字に切り詰める', async () => {
            mockFetchWithRetry.mockResolvedValue(createResponse({
                choices: [{ message: { content: 'summary' } }],
                usage: { prompt_tokens: 1, completion_tokens: 1 }
            }));

            const settings = {
                openai_base_url: 'http://127.0.0.1:1234/v1',
                openai_api_key: '',
                openai_model: 'local-model',
                [StorageKeys.OPENAI_CONTENT_CHARS]: 15000
            } as any;
            const provider = new OpenAIProvider(settings);
            const longContent = 'c'.repeat(20_000);

            await provider.generateSummary(longContent);

            const body = JSON.parse(mockFetchWithRetry.mock.calls[0][1].body);
            const userContent = body.messages[1].content;
            const contentMatch = userContent.match(/Content:\n([\s\S]*)$/);
            const actualContent = contentMatch ? contentMatch[1] : '';
            expect(actualContent.length).toBe(4_000);
        });
    });
});
