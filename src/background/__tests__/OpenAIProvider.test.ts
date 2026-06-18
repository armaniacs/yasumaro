/**
 * OpenAIProvider.test.ts
 * OpenAIProvider.ts の単体テスト
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
    getAllowedUrls: vi.fn(async () => new Set(['https://api.openai.com'])),
    StorageKeys: {
        MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
        CUSTOM_PROMPTS: 'custom_prompts',
        PROVIDER_BASE_URL: 'provider_base_url',
        PROVIDER_API_KEY: 'provider_api_key',
        PROVIDER_MODEL: 'provider_model'
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
    applyCustomPrompt: vi.fn((_s: any, _p: string, content: string) => ({
        userPrompt: `Summarize: ${content}`,
        systemPrompt: 'You are a helpful assistant.',
        isCustom: false
    }))
}));

// aiUsageTracker モック
vi.mock('../../utils/aiUsageTracker.js', () => ({
    checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 9, resetTime: 60 })),
    checkUsageWarning: vi.fn(async () => ({ warning: false })),
    recordUsage: vi.fn(async () => {}),
    getRateLimitMessage: vi.fn((t: number) => `Wait ${t}s.`)
}));

import { OpenAIProvider } from '../ai/providers/OpenAIProvider.js';
import { fetchWithRetry } from '../../utils/fetch.js';
import * as aiUsageTrackerModule from '../../utils/aiUsageTracker.js';
import * as promptSanitizerModule from '../../utils/promptSanitizer.js';

const { checkRateLimit, checkUsageWarning } = vi.mocked(aiUsageTrackerModule);
const { sanitizePromptContent } = vi.mocked(promptSanitizerModule);

describe('OpenAIProvider', () => {
    const baseSettings = {
        openai_api_key: 'test-key',
        openai_base_url: 'https://api.openai.com/v1',
        openai_model: 'gpt-4'
    };

    beforeEach(() => { vi.clearAllMocks(); });

    describe('constructor', () => {
        test('openai プロバイダーを作成', () => {
            const p = new OpenAIProvider(baseSettings);
            expect(p.getName()).toBe('openai');
        });

        test('openai2 プロバイダーを作成', () => {
            const p = new OpenAIProvider({
                ...baseSettings,
                openai_2_api_key: 'key2',
                openai_2_base_url: 'https://api2.openai.com/v1',
                openai_2_model: 'gpt-4-turbo'
            }, 'openai2');
            expect(p.getName()).toBe('openai2');
        });

        test('openai-compatible プロバイダーを作成', () => {
            const p = new OpenAIProvider({
                ...baseSettings,
                provider_base_url: 'https://custom.api.com/v1',
                provider_api_key: 'custom-key',
                provider_model: 'custom-model'
            }, 'openai-compatible');
            expect(p.getName()).toBe('openai-compatible');
        });
    });

    describe('generateSummary', () => {
        test('baseUrl が未設定の場合はデフォルトURLを使用', async () => {
            (fetchWithRetry as vi.Mock).mockResolvedValue({
                ok: true,
                json: async () => ({ choices: [{ message: { content: 'OK' } }] })
            });

            const p = new OpenAIProvider({ ...baseSettings, openai_base_url: '' });
            await p.generateSummary('content');

            const url = (fetchWithRetry as vi.Mock).mock.calls[0][0];
            expect(url).toContain('https://api.openai.com/v1/chat/completions');
        });

        test('レート制限時はエラー', async () => {
            checkRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, resetTime: 30 });

            const p = new OpenAIProvider(baseSettings);
            const result = await p.generateSummary('content');
            expect(result.summary).toContain('Wait');
        });

        test('成功時にサマリーを返す', async () => {
            (fetchWithRetry as vi.Mock).mockResolvedValue({
                ok: true,
                json: async () => ({
                    choices: [{ message: { content: 'Summary result' } }],
                    usage: { prompt_tokens: 100, completion_tokens: 50 }
                })
            });

            const p = new OpenAIProvider(baseSettings);
            const result = await p.generateSummary('Test content');

            expect(result.summary).toBe('Summary result');
            expect(result.sentTokens).toBe(100);
            expect(result.receivedTokens).toBe(50);
        });

        test('APIキーがない場合もリクエストを送る（Authorization なし）', async () => {
            (fetchWithRetry as vi.Mock).mockResolvedValue({
                ok: true,
                json: async () => ({
                    choices: [{ message: { content: 'OK' } }]
                })
            });

            const p = new OpenAIProvider({ ...baseSettings, openai_api_key: '' });
            await p.generateSummary('content');

            const headers = (fetchWithRetry as vi.Mock).mock.calls[0][1].headers;
            expect(headers['Authorization']).toBeUndefined();
        });

        test('APIエラーでエラーメッセージ', async () => {
            (fetchWithRetry as vi.Mock).mockResolvedValue({ ok: false, status: 500 });

            const p = new OpenAIProvider(baseSettings);
            const result = await p.generateSummary('content');
            expect(result.summary).toContain('Error');
        });

        test('タイムアウトエラーでタイムアウトメッセージ', async () => {
            (fetchWithRetry as vi.Mock).mockRejectedValue(new Error('timed out'));

            const p = new OpenAIProvider(baseSettings);
            const result = await p.generateSummary('content');
            expect(result.summary).toContain('timed out');
        });

        test('プロンプトインジェクション HIGH でブロック', async () => {
            sanitizePromptContent.mockReturnValueOnce({
                sanitized: 'x', warnings: ['attack'], dangerLevel: 'high'
            });

            const p = new OpenAIProvider(baseSettings);
            const result = await p.generateSummary('malicious');
            expect(result.summary).toContain('security risk');
        });

        test('choices が空の場合はデフォルトメッセージ', async () => {
            (fetchWithRetry as vi.Mock).mockResolvedValue({
                ok: true,
                json: async () => ({ choices: [] })
            });

            const p = new OpenAIProvider(baseSettings);
            const result = await p.generateSummary('content');
            expect(result.summary).toBe('No summary generated.');
        });

        test('ローカルURLの場合、コンテンツを4000文字に切り詰める', async () => {
            (fetchWithRetry as vi.Mock).mockResolvedValue({
                ok: true,
                json: async () => ({ choices: [{ message: { content: 'OK' } }] })
            });

            const lmStudioSettings = {
                lm_studio_base_url: 'http://127.0.0.1:1234/v1',
                lm_studio_model: 'test-model'
            };
            const p = new OpenAIProvider(lmStudioSettings, 'lm-studio');

            // 10000文字のコンテンツを送る
            const longContent = 'あ'.repeat(10000);
            await p.generateSummary(longContent);

            const body = JSON.parse((fetchWithRetry as vi.Mock).mock.calls[0][1].body);
            const userPrompt = body.messages[1].content as string;
            // 4000文字を超えたコンテンツは送られない
            expect(userPrompt.length).toBeLessThanOrEqual(4200); // プロンプトテンプレート分の余裕を含む
        });

        test('クラウドURLの場合、コンテンツを10000文字に切り詰める', async () => {
            (fetchWithRetry as vi.Mock).mockResolvedValue({
                ok: true,
                json: async () => ({ choices: [{ message: { content: 'OK' } }] })
            });

            const p = new OpenAIProvider(baseSettings);

            // 15000文字のコンテンツを送る
            const longContent = 'a'.repeat(15000);
            await p.generateSummary(longContent);

            const body = JSON.parse((fetchWithRetry as vi.Mock).mock.calls[0][1].body);
            const userPrompt = body.messages[1].content as string;
            // 10000文字を超えたコンテンツは送られない
            expect(userPrompt.length).toBeLessThanOrEqual(10200);
        });

        test('baseUrl 末尾スラッシュを除去', async () => {
            (fetchWithRetry as vi.Mock).mockResolvedValue({
                ok: true,
                json: async () => ({ choices: [{ message: { content: 'OK' } }] })
            });

            const p = new OpenAIProvider({ ...baseSettings, openai_base_url: 'https://api.openai.com/v1/' });
            await p.generateSummary('content');

            const url = (fetchWithRetry as vi.Mock).mock.calls[0][0];
            expect(url).toBe('https://api.openai.com/v1/chat/completions');
            expect(url).not.toContain('v1//chat');
        });
    });

    describe('testConnection', () => {
        test('baseUrl 未設定でもデフォルトURLでテストする', async () => {
            (fetchWithRetry as vi.Mock).mockResolvedValue({ ok: true });

            const p = new OpenAIProvider({ ...baseSettings, openai_base_url: '' });
            const result = await p.testConnection();
            expect(result.success).toBe(true);
        });

        test('接続成功時', async () => {
            (fetchWithRetry as vi.Mock).mockResolvedValue({ ok: true });

            const p = new OpenAIProvider(baseSettings);
            const result = await p.testConnection();
            expect(result.success).toBe(true);
        });

        test('401 で認証エラー', async () => {
            (fetchWithRetry as vi.Mock).mockResolvedValue({ ok: false, status: 401 });

            const p = new OpenAIProvider(baseSettings);
            const result = await p.testConnection();
            expect(result.success).toBe(false);
            expect(result.message).toContain('Authentication failed');
        });

        test('404 でエンドポイント未発見', async () => {
            (fetchWithRetry as vi.Mock).mockResolvedValue({ ok: false, status: 404 });

            const p = new OpenAIProvider(baseSettings);
            const result = await p.testConnection();
            expect(result.success).toBe(false);
            expect(result.message).toContain('not found');
        });

        test('429 でレート制限', async () => {
            (fetchWithRetry as vi.Mock).mockResolvedValue({ ok: false, status: 429 });

            const p = new OpenAIProvider(baseSettings);
            const result = await p.testConnection();
            expect(result.success).toBe(false);
            expect(result.message).toContain('Rate limit');
        });

        test('ネットワークエラーで Cannot connect', async () => {
            (fetchWithRetry as vi.Mock).mockRejectedValue(new Error('Failed to fetch'));

            const p = new OpenAIProvider(baseSettings);
            const result = await p.testConnection();
            expect(result.success).toBe(false);
            expect(result.message).toContain('Cannot connect');
        });

        test('タイムアウトエラー', async () => {
            (fetchWithRetry as vi.Mock).mockRejectedValue(new Error('timeout'));

            const p = new OpenAIProvider(baseSettings);
            const result = await p.testConnection();
            expect(result.success).toBe(false);
            expect(result.message).toContain('timeout');
        });
    });
});
