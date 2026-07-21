/**
 * GeminiProvider.test.ts
 * GeminiProvider の文字数切り詰め・設定値テスト
 */

import { vi, describe, test, expect, beforeEach } from 'vitest';
import { GeminiProvider } from '../GeminiProvider.js';
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
    recordUsage: vi.fn(),
    getRateLimitMessage: vi.fn(() => 'Rate limit exceeded')
}));

vi.mock('../../../../utils/promptSanitizer.js', () => ({
    sanitizePromptContent: (content: string) => ({ sanitized: content, warnings: [], dangerLevel: 'low' })
}));

vi.mock('../../../../utils/customPromptUtils.js', () => ({
    applyCustomPrompt: (_settings: any, _providerName: string, content: string) => ({
        userPrompt: `Content:\n${content}`
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

describe('GeminiProvider', () => {
    beforeEach(() => {
        mockFetchWithRetry.mockReset();
    });

    describe('response schema validation', () => {
        test('candidates が空の場合はスキーマエラー', async () => {
            mockFetchWithRetry.mockResolvedValue(createResponse({ candidates: [] }));

            const settings = {
                gemini_api_key: 'test-key',
                gemini_model: 'gemini-3.1-flash-lite'
            } as any;
            const provider = new GeminiProvider(settings);
            const result = await provider.generateSummary('content');

            expect(result.success).toBe(false);
            expect(result.summary).toContain('Error: Invalid API response format');
            expect(result.error).toContain('candidates is missing or empty');
        });

        test('parts[0].text が文字列でない場合はスキーマエラー', async () => {
            mockFetchWithRetry.mockResolvedValue(createResponse({
                candidates: [{ content: { parts: [{ role: 'model' }] } }]
            }));

            const settings = {
                gemini_api_key: 'test-key',
                gemini_model: 'gemini-3.1-flash-lite'
            } as any;
            const provider = new GeminiProvider(settings);
            const result = await provider.generateSummary('content');

            expect(result.success).toBe(false);
            expect(result.summary).toContain('Error: Invalid API response format');
            expect(result.error).toContain('parts[0].text is not a string');
        });
    });

    describe('API version configurability', () => {
        test('testConnection が設定された API バージョンを使用する', async () => {
            mockFetchWithRetry.mockResolvedValue(createResponse({
                models: [{ name: 'models/gemini-3.1-flash-lite' }]
            }));

            const settings = {
                gemini_api_key: 'test-key',
                gemini_model: 'gemini-3.1-flash-lite',
                [StorageKeys.GEMINI_API_VERSION]: 'v1'
            } as any;
            const provider = new GeminiProvider(settings);

            await provider.testConnection();

            const url = mockFetchWithRetry.mock.calls[0][0];
            expect(url).toBe('https://generativelanguage.googleapis.com/v1/models');
        });
    });

    describe('content length truncation', () => {
        test('デフォルトで 30,000 文字に切り詰める', async () => {
            mockFetchWithRetry.mockResolvedValue(createResponse({
                candidates: [{ content: { parts: [{ text: 'summary' }] } }],
                usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 }
            }));

            const settings = {
                gemini_api_key: 'test-key',
                gemini_model: 'gemini-3.1-flash-lite'
            } as any;
            const provider = new GeminiProvider(settings);
            const longContent = 'a'.repeat(40_000);

            await provider.generateSummary(longContent);

            const body = JSON.parse(mockFetchWithRetry.mock.calls[0][1].body);
            const userContent = body.contents[0].parts[0].text;
            const contentMatch = userContent.match(/Content:\n([\s\S]*)$/);
            const actualContent = contentMatch ? contentMatch[1] : '';
            expect(actualContent.length).toBe(30_000);
        });

        test('gemini_api_version 設定で API URL のバージョンを上書きする', async () => {
            mockFetchWithRetry.mockResolvedValue(createResponse({
                candidates: [{ content: { parts: [{ text: 'summary' }] } }],
                usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 }
            }));

            const settings = {
                gemini_api_key: 'test-key',
                gemini_model: 'gemini-3.1-flash-lite',
                [StorageKeys.GEMINI_API_VERSION]: 'v1'
            } as any;
            const provider = new GeminiProvider(settings);

            await provider.generateSummary('content');

            const url = mockFetchWithRetry.mock.calls[0][0];
            expect(url).toContain('/v1/models/');
            expect(url).not.toContain('/v1beta/models/');
        });

        test('gemini_api_version が未設定の場合はデフォルト v1beta を使用する', async () => {
            mockFetchWithRetry.mockResolvedValue(createResponse({
                candidates: [{ content: { parts: [{ text: 'summary' }] } }],
                usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 }
            }));

            const settings = {
                gemini_api_key: 'test-key',
                gemini_model: 'gemini-3.1-flash-lite'
            } as any;
            const provider = new GeminiProvider(settings);

            await provider.generateSummary('content');

            const url = mockFetchWithRetry.mock.calls[0][0];
            expect(url).toContain('/v1beta/models/');
        });

        test('gemini_content_chars 設定で切り詰め文字数を上書きする', async () => {
            mockFetchWithRetry.mockResolvedValue(createResponse({
                candidates: [{ content: { parts: [{ text: 'summary' }] } }],
                usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 }
            }));

            const settings = {
                gemini_api_key: 'test-key',
                gemini_model: 'gemini-3.1-flash-lite',
                [StorageKeys.GEMINI_CONTENT_CHARS]: 20000
            } as any;
            const provider = new GeminiProvider(settings);
            const longContent = 'b'.repeat(40_000);

            await provider.generateSummary(longContent);

            const body = JSON.parse(mockFetchWithRetry.mock.calls[0][1].body);
            const userContent = body.contents[0].parts[0].text;
            const contentMatch = userContent.match(/Content:\n([\s\S]*)$/);
            const actualContent = contentMatch ? contentMatch[1] : '';
            expect(actualContent.length).toBe(20_000);
        });
    });
});
