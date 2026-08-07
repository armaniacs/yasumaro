/**
 * GeminiProvider.test.ts
 * GeminiProvider.ts の単体テスト
 */

import { webcrypto as crypto } from '@peculiar/webcrypto';
import { vi } from 'vitest';
Object.defineProperty(global, 'crypto', { value: crypto });

// fetch モック
vi.mock('../../utils/fetch.js', () => ({
    fetchWithRetry: vi.fn(),
    validateUrlForAIRequests: vi.fn()
}));

// logger モック
vi.mock('../../utils/logger.js', () => ({
    addLog: vi.fn(),
    LogType: { ERROR: 'error', WARN: 'warn', INFO: 'info' }
}));

// storage モック
vi.mock('../../utils/storage.js', () => ({
    getAllowedUrls: vi.fn(async () => new Set(['https://generativelanguage.googleapis.com'])),
    StorageKeys: {
        MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
        CUSTOM_PROMPTS: 'custom_prompts',
        AI_TIMEOUT_MS: 'ai_timeout_ms',
        GEMINI_API_VERSION: 'gemini_api_version',
        GEMINI_CONTENT_CHARS: 'gemini_content_chars'
    },
    Settings: {}
}));

// promptSanitizer モック
vi.mock('../../utils/promptSanitizer.js', () => ({
    sanitizePromptContent: vi.fn((content: string) => ({
        sanitized: content,
        warnings: [],
        dangerLevel: 'low'
    }))
}));

// customPromptUtils モック
vi.mock('../../utils/customPromptUtils.js', () => ({
    applyCustomPrompt: vi.fn((_settings: any, _provider: string, content: string) => ({
        userPrompt: `Summarize: ${content}`,
        systemPrompt: 'You are a helpful assistant.',
        isCustom: false
    })),
    getDefaultSystemPrompt: vi.fn(() => 'Default system prompt.')
}));

// aiUsageTracker モック
vi.mock('../../utils/aiUsageTracker.js', () => ({
    checkHardLimit: vi.fn(async () => ({ blocked: false })),
    checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 9, resetTime: 60 })),
    checkUsageWarning: vi.fn(async () => ({ warning: false })),
    recordUsage: vi.fn(async () => {}),
    getRateLimitMessage: vi.fn((resetTime: number) => `Rate limited. Wait ${resetTime}s.`)
}));

import { GeminiProvider } from '../ai/providers/GeminiProvider.js';
import { fetchWithRetry, validateUrlForAIRequests } from '../../utils/fetch.js';
import * as aiUsageTrackerModule from '../../utils/aiUsageTracker.js';
import * as promptSanitizerModule from '../../utils/promptSanitizer.js';
import * as customPromptUtilsModule from '../../utils/customPromptUtils.js';

const { checkHardLimit, checkRateLimit, checkUsageWarning } = vi.mocked(aiUsageTrackerModule);
const { sanitizePromptContent } = vi.mocked(promptSanitizerModule);
const { applyCustomPrompt } = vi.mocked(customPromptUtilsModule);

describe('GeminiProvider', () => {

    const baseSettings = {
        gemini_api_key: 'test-api-key',
        gemini_model: 'gemini-3.1-flash-lite'
    };

    beforeEach(() => {
        vi.clearAllMocks();
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

        test('設定したタイムアウトを使用する', () => {
            const provider = new GeminiProvider({ ...baseSettings, ai_timeout_ms: 60000 });
            expect(provider.timeoutMs).toBe(60000);
        });

        test('タイムアウト未設定の場合はデフォルト 30000', () => {
            const provider = new GeminiProvider(baseSettings);
            expect(provider.timeoutMs).toBe(30000);
        });

        test('設定したタイムアウトをリクエストに渡す', async () => {
            (fetchWithRetry as vi.Mock).mockResolvedValue({
                ok: true,
                json: async () => ({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] })
            });

            const provider = new GeminiProvider({ ...baseSettings, ai_timeout_ms: 60000 });
            await provider.generateSummary('content');

            const options = (fetchWithRetry as vi.Mock).mock.calls[0][1];
            expect(options.timeoutMs).toBe(60000);
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
            checkRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, resetTime: 30 });

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.generateSummary('content');

            expect(result.summary).toContain('Rate limited');
        });

        test('成功時にサマリーを返す', async () => {
            (fetchWithRetry as vi.Mock).mockResolvedValue({
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

        test('成功結果に providerName と model を含める', async () => {
            (fetchWithRetry as vi.Mock).mockResolvedValue({
                ok: true,
                json: async () => ({
                    candidates: [{ content: { parts: [{ text: 'Summary' }] } }],
                    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 }
                })
            });

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.generateSummary('content');

            expect(result.providerName).toBe('gemini');
            expect(result.model).toBe('gemini-3.1-flash-lite');
        });

        test('APIエラーレスポンスでエラーメッセージ', async () => {
            (fetchWithRetry as vi.Mock).mockResolvedValue({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error'
            });

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.generateSummary('content');

            expect(result.summary).toContain('Error');
        });

        test('404エラーでモデル未発見メッセージ', async () => {
            (fetchWithRetry as vi.Mock).mockResolvedValue({
                ok: false,
                status: 404
            });

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.generateSummary('content');

            expect(result.summary).toContain('Model not found');
        });

        test('タイムアウトエラーでタイムアウトメッセージ', async () => {
            (fetchWithRetry as vi.Mock).mockRejectedValue(new Error('Request timed out'));

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.generateSummary('content');

            expect(result.summary).toContain('timed out');
        });

        test('プロンプトインジェクション HIGH でブロック', async () => {
            sanitizePromptContent.mockReturnValueOnce({
                sanitized: 'blocked',
                warnings: ['injection'],
                dangerLevel: 'high'
            });

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.generateSummary('malicious');

            expect(result.summary).toContain('security risk');
        });

        test('candidates が空の場合はスキーマエラー', async () => {
            (fetchWithRetry as vi.Mock).mockResolvedValue({
                ok: true,
                json: async () => ({ candidates: [] })
            });

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.generateSummary('content');

            expect(result.success).toBe(false);
            expect(result.summary).toContain('Error: Invalid API response format');
            expect(result.error).toContain('candidates is missing or empty');
        });

        test('parts[0].text がない場合はスキーマエラー', async () => {
            (fetchWithRetry as vi.Mock).mockResolvedValue({
                ok: true,
                json: async () => ({
                    candidates: [{ content: { parts: [{ role: 'model' }] } }]
                })
            });

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.generateSummary('content');

            expect(result.success).toBe(false);
            expect(result.summary).toContain('Error: Invalid API response format');
            expect(result.error).toContain('parts[0].text is not a string');
        });

        test('モデル名から models/ プレフィックスを除去する', async () => {
            (fetchWithRetry as vi.Mock).mockResolvedValue({
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

            const callUrl = (fetchWithRetry as vi.Mock).mock.calls[0][0];
            expect(callUrl).toContain('gemini-pro:generateContent');
            expect(callUrl).not.toContain('models/models/');
        });

        test('ペイロードに systemInstruction を含める', async () => {
            (fetchWithRetry as vi.Mock).mockResolvedValue({
                ok: true,
                json: async () => ({
                    candidates: [{ content: { parts: [{ text: 'Summary' }] } }],
                    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 }
                })
            });

            const provider = new GeminiProvider(baseSettings);
            await provider.generateSummary('content');

            const options = (fetchWithRetry as vi.Mock).mock.calls[0][1];
            const body = JSON.parse(options.body);
            expect(body.systemInstruction).toBeDefined();
            expect(body.systemInstruction.parts[0].text).toBe('You are a helpful assistant.');
        });

        test('systemPrompt が空の場合はデフォルトシステムプロンプトを使用する', async () => {
            (applyCustomPrompt as vi.Mock).mockReturnValueOnce({
                userPrompt: 'Summarize: content',
                systemPrompt: '',
                isCustom: false
            });
            (fetchWithRetry as vi.Mock).mockResolvedValue({
                ok: true,
                json: async () => ({
                    candidates: [{ content: { parts: [{ text: 'Summary' }] } }],
                    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 }
                })
            });

            const provider = new GeminiProvider(baseSettings);
            await provider.generateSummary('content');

            const options = (fetchWithRetry as vi.Mock).mock.calls[0][1];
            const body = JSON.parse(options.body);
            expect(body.systemInstruction.parts[0].text).toBe('Default system prompt.');
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
            (validateUrlForAIRequests as vi.Mock).mockImplementation(() => {});
            (fetchWithRetry as vi.Mock).mockResolvedValue({ ok: true });

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.testConnection();

            expect(result.success).toBe(true);
            expect(result.message).toContain('Connected');
        });

        test('401エラーで認証失敗メッセージ', async () => {
            (validateUrlForAIRequests as vi.Mock).mockImplementation(() => {});
            (fetchWithRetry as vi.Mock).mockResolvedValue({
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
            (validateUrlForAIRequests as vi.Mock).mockImplementation(() => {});
            (fetchWithRetry as vi.Mock).mockResolvedValue({
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
            (validateUrlForAIRequests as vi.Mock).mockImplementation(() => {});
            (fetchWithRetry as vi.Mock).mockRejectedValue(new Error('timeout'));

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.testConnection();

            expect(result.success).toBe(false);
            expect(result.message).toContain('timeout');
        });

        test('一般的なエラーでエラーメッセージ', async () => {
            (validateUrlForAIRequests as vi.Mock).mockImplementation(() => {});
            (fetchWithRetry as vi.Mock).mockRejectedValue(new Error('Network error'));

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.testConnection();

            expect(result.success).toBe(false);
            expect(result.message).toContain('Network error');
        });

        test('AbortError でタイムアウトメッセージ', async () => {
            (validateUrlForAIRequests as vi.Mock).mockImplementation(() => {});
            const abortError = new Error('The operation was aborted');
            abortError.name = 'AbortError';
            (fetchWithRetry as vi.Mock).mockRejectedValue(abortError);

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.testConnection();

            expect(result.success).toBe(false);
            expect(result.message).toContain('timed out');
        });

        test('HTTP 401 のスローエラーで無効な API キー', async () => {
            (validateUrlForAIRequests as vi.Mock).mockImplementation(() => {});
            (fetchWithRetry as vi.Mock).mockRejectedValue(new Error('HTTP 401: Unauthorized'));

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.testConnection();

            expect(result.success).toBe(false);
            expect(result.message).toContain('Invalid API key');
        });

        test('HTTP 404 のスローエラーでモデル未発見', async () => {
            (validateUrlForAIRequests as vi.Mock).mockImplementation(() => {});
            (fetchWithRetry as vi.Mock).mockRejectedValue(new Error('HTTP 404: Not Found'));

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.testConnection();

            expect(result.success).toBe(false);
            expect(result.message).toContain('not found');
        });

    describe('API version configurability', () => {
        test('testConnection が設定された API バージョンを使用する', async () => {
            (fetchWithRetry as vi.Mock).mockResolvedValue({
                ok: true,
                json: async () => ({ models: [{ name: 'models/gemini-3.1-flash-lite' }] })
            });

            const provider = new GeminiProvider({
                ...baseSettings,
                gemini_api_version: 'v1'
            });

            await provider.testConnection();

            const url = (fetchWithRetry as vi.Mock).mock.calls[0][0];
            expect(url).toBe('https://generativelanguage.googleapis.com/v1/models');
        });

        test('gemini_api_version 設定で API URL のバージョンを上書きする', async () => {
            (fetchWithRetry as vi.Mock).mockResolvedValue({
                ok: true,
                json: async () => ({
                    candidates: [{ content: { parts: [{ text: 'summary' }] } }],
                    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 }
                })
            });

            const provider = new GeminiProvider({
                ...baseSettings,
                gemini_api_version: 'v1'
            });

            await provider.generateSummary('content');

            const url = (fetchWithRetry as vi.Mock).mock.calls[0][0];
            expect(url).toContain('/v1/models/');
            expect(url).not.toContain('/v1beta/models/');
        });

        test('gemini_api_version が未設定の場合はデフォルト v1beta を使用する', async () => {
            (fetchWithRetry as vi.Mock).mockResolvedValue({
                ok: true,
                json: async () => ({
                    candidates: [{ content: { parts: [{ text: 'summary' }] } }],
                    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 }
                })
            });

            const provider = new GeminiProvider(baseSettings);

            await provider.generateSummary('content');

            const url = (fetchWithRetry as vi.Mock).mock.calls[0][0];
            expect(url).toContain('/v1beta/models/');
        });
    });

    describe('content length truncation', () => {
        test('デフォルトで 30,000 文字に切り詰める', async () => {
            (fetchWithRetry as vi.Mock).mockResolvedValue({
                ok: true,
                json: async () => ({
                    candidates: [{ content: { parts: [{ text: 'summary' }] } }],
                    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 }
                })
            });

            const provider = new GeminiProvider(baseSettings);
            const longContent = 'a'.repeat(40_000);

            await provider.generateSummary(longContent);

            const body = JSON.parse((fetchWithRetry as vi.Mock).mock.calls[0][1].body);
            const userContent = body.contents[0].parts[0].text as string;
            const actualContent = userContent.replace(/^Summarize: /, '');
            expect(actualContent.length).toBe(30_000);
        });

        test('gemini_content_chars 設定で切り詰め文字数を上書きする', async () => {
            (fetchWithRetry as vi.Mock).mockResolvedValue({
                ok: true,
                json: async () => ({
                    candidates: [{ content: { parts: [{ text: 'summary' }] } }],
                    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 }
                })
            });

            const provider = new GeminiProvider({
                ...baseSettings,
                gemini_content_chars: 20000
            });
            const longContent = 'b'.repeat(40_000);

            await provider.generateSummary(longContent);

            const body = JSON.parse((fetchWithRetry as vi.Mock).mock.calls[0][1].body);
            const userContent = body.contents[0].parts[0].text as string;
            const actualContent = userContent.replace(/^Summarize: /, '');
            expect(actualContent.length).toBe(20_000);
        });
    });
    });
});
