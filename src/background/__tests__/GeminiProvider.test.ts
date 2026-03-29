/**
 * GeminiProvider.test.ts
 * GeminiProvider.ts の単体テスト
 */

import { webcrypto as crypto } from '@peculiar/webcrypto';
Object.defineProperty(global, 'crypto', { value: crypto });

// fetch モック
jest.mock('../../utils/fetch.js', () => ({
    fetchWithRetry: jest.fn(),
    validateUrlForAIRequests: jest.fn()
}));

// logger モック
jest.mock('../../utils/logger.js', () => ({
    addLog: jest.fn(),
    LogType: { ERROR: 'error', WARN: 'warn', INFO: 'info' }
}));

// storage モック
jest.mock('../../utils/storage.js', () => ({
    getAllowedUrls: jest.fn(async () => new Set(['https://generativelanguage.googleapis.com'])),
    StorageKeys: {
        MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
        CUSTOM_PROMPTS: 'custom_prompts'
    },
    Settings: {}
}));

// promptSanitizer モック
jest.mock('../../utils/promptSanitizer.js', () => ({
    sanitizePromptContent: jest.fn((content: string) => ({
        sanitized: content,
        warnings: [],
        dangerLevel: 'low'
    }))
}));

// customPromptUtils モック
jest.mock('../../utils/customPromptUtils.js', () => ({
    applyCustomPrompt: jest.fn((_settings: any, _provider: string, content: string) => ({
        userPrompt: `Summarize: ${content}`,
        systemPrompt: 'You are a helpful assistant.',
        isCustom: false
    }))
}));

// aiUsageTracker モック
jest.mock('../../utils/aiUsageTracker.js', () => ({
    checkRateLimit: jest.fn(async () => ({ allowed: true, remaining: 9, resetTime: 60 })),
    recordUsage: jest.fn(async () => {}),
    getRateLimitMessage: jest.fn((resetTime: number) => `Rate limited. Wait ${resetTime}s.`)
}));

import { GeminiProvider } from '../ai/providers/GeminiProvider.js';
import { fetchWithRetry, validateUrlForAIRequests } from '../../utils/fetch.js';

describe('GeminiProvider', () => {

    const baseSettings = {
        gemini_api_key: 'test-api-key',
        gemini_model: 'gemini-1.5-flash'
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('constructor', () => {
        test('設定からAPIキーとモデルを設定する', () => {
            const provider = new GeminiProvider(baseSettings);
            expect(provider.getName()).toBe('gemini');
        });

        test('APIキーがない場合は空文字', () => {
            const provider = new GeminiProvider({ ...baseSettings, gemini_api_key: '' });
            expect(provider.getName()).toBe('gemini');
        });

        test('モデルが未設定の場合はデフォルト', () => {
            const provider = new GeminiProvider({ gemini_api_key: 'key' });
            expect(provider.getName()).toBe('gemini');
        });
    });

    describe('getName', () => {
        test('gemini を返す', () => {
            const provider = new GeminiProvider(baseSettings);
            expect(provider.getName()).toBe('gemini');
        });
    });

    describe('generateSummary', () => {
        test('APIキーがない場合はエラーメッセージ', async () => {
            const provider = new GeminiProvider({ ...baseSettings, gemini_api_key: '' });
            const result = await provider.generateSummary('content');

            expect(result.summary).toContain('API key is missing');
        });

        test('レート制限時はエラーメッセージ', async () => {
            const { checkRateLimit } = require('../../utils/aiUsageTracker.js');
            checkRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, resetTime: 30 });

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.generateSummary('content');

            expect(result.summary).toContain('Rate limited');
        });

        test('成功時にサマリーを返す', async () => {
            (fetchWithRetry as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => ({
                    candidates: [{ content: { parts: [{ text: 'Summary result' }] } }],
                    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 }
                })
            });

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.generateSummary('Test content');

            expect(result.summary).toBe('Summary result');
            expect(result.sentTokens).toBe(100);
            expect(result.receivedTokens).toBe(50);
        });

        test('APIエラーレスポンスでエラーメッセージ', async () => {
            (fetchWithRetry as jest.Mock).mockResolvedValue({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error'
            });

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.generateSummary('content');

            expect(result.summary).toContain('Error');
        });

        test('404エラーでモデル未発見メッセージ', async () => {
            (fetchWithRetry as jest.Mock).mockResolvedValue({
                ok: false,
                status: 404
            });

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.generateSummary('content');

            expect(result.summary).toContain('Model not found');
        });

        test('タイムアウトエラーでタイムアウトメッセージ', async () => {
            (fetchWithRetry as jest.Mock).mockRejectedValue(new Error('Request timed out'));

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.generateSummary('content');

            expect(result.summary).toContain('timed out');
        });

        test('プロンプトインジェクション HIGH でブロック', async () => {
            const { sanitizePromptContent } = require('../../utils/promptSanitizer.js');
            sanitizePromptContent.mockReturnValueOnce({
                sanitized: 'blocked',
                warnings: ['injection'],
                dangerLevel: 'high'
            });

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.generateSummary('malicious');

            expect(result.summary).toContain('security risk');
        });

        test('candidates が空の場合はデフォルトメッセージ', async () => {
            (fetchWithRetry as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => ({ candidates: [] })
            });

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.generateSummary('content');

            expect(result.summary).toBe('No summary generated.');
        });

        test('モデル名から models/ プレフィックスを除去する', async () => {
            (fetchWithRetry as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => ({
                    candidates: [{ content: { parts: [{ text: 'OK' }] } }]
                })
            });

            const provider = new GeminiProvider({
                ...baseSettings,
                gemini_model: 'models/gemini-pro'
            });
            await provider.generateSummary('content');

            const callUrl = (fetchWithRetry as jest.Mock).mock.calls[0][0];
            expect(callUrl).toContain('gemini-pro:generateContent');
            expect(callUrl).not.toContain('models/models/');
        });
    });

    describe('testConnection', () => {
        test('APIキーがない場合はエラー', async () => {
            const provider = new GeminiProvider({ ...baseSettings, gemini_api_key: '' });
            const result = await provider.testConnection();

            expect(result.success).toBe(false);
            expect(result.message).toContain('not set');
        });

        test('接続成功時', async () => {
            (validateUrlForAIRequests as jest.Mock).mockImplementation(() => {});
            (fetchWithRetry as jest.Mock).mockResolvedValue({ ok: true });

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.testConnection();

            expect(result.success).toBe(true);
            expect(result.message).toContain('Connected');
        });

        test('401エラーで認証失敗メッセージ', async () => {
            (validateUrlForAIRequests as jest.Mock).mockImplementation(() => {});
            (fetchWithRetry as jest.Mock).mockResolvedValue({
                ok: false,
                status: 401,
                statusText: 'Unauthorized'
            });

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.testConnection();

            expect(result.success).toBe(false);
            expect(result.message).toContain('Authentication failed');
        });

        test('429エラーでレート制限メッセージ', async () => {
            (validateUrlForAIRequests as jest.Mock).mockImplementation(() => {});
            (fetchWithRetry as jest.Mock).mockResolvedValue({
                ok: false,
                status: 429,
                statusText: 'Too Many Requests'
            });

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.testConnection();

            expect(result.success).toBe(false);
            expect(result.message).toContain('Rate limit');
        });

        test('タイムアウトエラーでネットワークエラーメッセージ', async () => {
            (validateUrlForAIRequests as jest.Mock).mockImplementation(() => {});
            (fetchWithRetry as jest.Mock).mockRejectedValue(new Error('timeout'));

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.testConnection();

            expect(result.success).toBe(false);
            expect(result.message).toContain('timeout');
        });

        test('一般的なエラーでエラーメッセージ', async () => {
            (validateUrlForAIRequests as jest.Mock).mockImplementation(() => {});
            (fetchWithRetry as jest.Mock).mockRejectedValue(new Error('Network error'));

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.testConnection();

            expect(result.success).toBe(false);
            expect(result.message).toContain('Network error');
        });
    });
});
