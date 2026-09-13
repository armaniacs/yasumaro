/**
 * OpenAIProvider.test.ts
 * OpenAIProvider.ts の単体テスト
 */

import { Crypto } from '@peculiar/webcrypto';
import { vi } from 'vitest';
import type { Mock } from 'vitest';

Object.defineProperty(global, 'crypto', { value: new Crypto() });

// fetch モック
vi.mock('../../utils/fetch.js', () => ({
    CONNECTION_TEST_CACHE_MODE: 'no-store',
    fetchWithRetry: vi.fn(),
    validateUrlForAIRequests: vi.fn()
}));

// logger モック
vi.mock('../../utils/logger.js', () => ({
    addLog: vi.fn(),
    LogType: { ERROR: 'error', WARN: 'warn', INFO: 'info' }
}));

// storage モック
vi.mock('../../utils/storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

      getAllowedUrls: vi.fn(async () => new Set(['https://api.openai.com'])),
      StorageKeys: {
          MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
          CUSTOM_PROMPTS: 'custom_prompts',
          PROVIDER_BASE_URL: 'provider_base_url',
          PROVIDER_API_KEY: 'provider_api_key',
          PROVIDER_MODEL: 'provider_model',
          OPENAI_CONTENT_CHARS: 'openai_content_chars'
      },
      Settings: {}

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/defaults.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

      getAllowedUrls: vi.fn(async () => new Set(['https://api.openai.com'])),
      StorageKeys: {
          MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
          CUSTOM_PROMPTS: 'custom_prompts',
          PROVIDER_BASE_URL: 'provider_base_url',
          PROVIDER_API_KEY: 'provider_api_key',
          PROVIDER_MODEL: 'provider_model',
          OPENAI_CONTENT_CHARS: 'openai_content_chars'
      },
      Settings: {}

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/encryptionSession.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

      getAllowedUrls: vi.fn(async () => new Set(['https://api.openai.com'])),
      StorageKeys: {
          MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
          CUSTOM_PROMPTS: 'custom_prompts',
          PROVIDER_BASE_URL: 'provider_base_url',
          PROVIDER_API_KEY: 'provider_api_key',
          PROVIDER_MODEL: 'provider_model',
          OPENAI_CONTENT_CHARS: 'openai_content_chars'
      },
      Settings: {}

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/savedUrlRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

      getAllowedUrls: vi.fn(async () => new Set(['https://api.openai.com'])),
      StorageKeys: {
          MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
          CUSTOM_PROMPTS: 'custom_prompts',
          PROVIDER_BASE_URL: 'provider_base_url',
          PROVIDER_API_KEY: 'provider_api_key',
          PROVIDER_MODEL: 'provider_model',
          OPENAI_CONTENT_CHARS: 'openai_content_chars'
      },
      Settings: {}

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/domainFilterCache.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

      getAllowedUrls: vi.fn(async () => new Set(['https://api.openai.com'])),
      StorageKeys: {
          MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
          CUSTOM_PROMPTS: 'custom_prompts',
          PROVIDER_BASE_URL: 'provider_base_url',
          PROVIDER_API_KEY: 'provider_api_key',
          PROVIDER_MODEL: 'provider_model',
          OPENAI_CONTENT_CHARS: 'openai_content_chars'
      },
      Settings: {}

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/quota.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

      getAllowedUrls: vi.fn(async () => new Set(['https://api.openai.com'])),
      StorageKeys: {
          MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
          CUSTOM_PROMPTS: 'custom_prompts',
          PROVIDER_BASE_URL: 'provider_base_url',
          PROVIDER_API_KEY: 'provider_api_key',
          PROVIDER_MODEL: 'provider_model',
          OPENAI_CONTENT_CHARS: 'openai_content_chars'
      },
      Settings: {}

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;

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
    checkHardLimit: vi.fn(async () => ({ blocked: false })),
    checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 9, resetTime: 60 })),
    checkUsageWarning: vi.fn(async () => ({ warning: false })),
    recordUsage: vi.fn(async () => {}),
    getRateLimitMessage: vi.fn((t: number) => `Wait ${t}s.`)
}));

import { OpenAIProvider } from '../ai/providers/OpenAIProvider.js';
import { fetchWithRetry } from '../../utils/fetch.js';
import * as aiUsageTrackerModule from '../../utils/aiUsageTracker.js';
import * as promptSanitizerModule from '../../utils/promptSanitizer.js';

const { checkHardLimit, checkRateLimit, checkUsageWarning, recordUsage } = vi.mocked(aiUsageTrackerModule);
const { sanitizePromptContent } = vi.mocked(promptSanitizerModule);

describe('OpenAIProvider', () => {
    const baseSettings = {
        openai_api_key: 'test-key',
        openai_base_url: 'https://api.openai.com/v1',
        openai_model: 'gpt-4'
    };

    beforeEach(() => { vi.clearAllMocks(); });

    describe('constructor', () => {
        test('creates the openai provider', () => {
            const p = new OpenAIProvider(baseSettings);
            expect(p.getName()).toBe('openai');
        });

        test('creates the openai2 provider', () => {
            const p = new OpenAIProvider({
                ...baseSettings,
                openai_2_api_key: 'key2',
                openai_2_base_url: 'https://api2.openai.com/v1',
                openai_2_model: 'gpt-4-turbo'
            }, 'openai2');
            expect(p.getName()).toBe('openai2');
        });

        test('creates the openai-compatible provider', () => {
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
        test('uses the default URL when baseUrl is not set', async () => {
            (fetchWithRetry as Mock).mockResolvedValue({
                ok: true,
                json: async () => ({ choices: [{ message: { content: 'OK' } }] })
            });

            const p = new OpenAIProvider({ ...baseSettings, openai_base_url: '' });
            await p.generateSummary('content');

            const url = (fetchWithRetry as Mock).mock.calls[0]![0];
            expect(url).toContain('https://api.openai.com/v1/chat/completions');
        });

        test('returns an error on rate limiting', async () => {
            checkRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, resetTime: 30 });

            const p = new OpenAIProvider(baseSettings);
            const result = await p.generateSummary('content');
            expect(result.summary).toContain('Wait');
        });

        test('returns a summary on success', async () => {
            (fetchWithRetry as Mock).mockResolvedValue({
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

        test('sends the request without Authorization when the API key is missing', async () => {
            (fetchWithRetry as Mock).mockResolvedValue({
                ok: true,
                json: async () => ({
                    choices: [{ message: { content: 'OK' } }]
                })
            });

            const p = new OpenAIProvider({ ...baseSettings, openai_api_key: '' });
            await p.generateSummary('content');

            const headers = (fetchWithRetry as Mock).mock.calls[0]![1].headers;
            expect(headers['Authorization']).toBeUndefined();
        });

        test('returns an error message on an API error', async () => {
            (fetchWithRetry as Mock).mockResolvedValue({ ok: false, status: 500 });

            const p = new OpenAIProvider(baseSettings);
            const result = await p.generateSummary('content');
            expect(result.summary).toContain('Error');
        });

        test('returns a timeout message on a timeout error', async () => {
            (fetchWithRetry as Mock).mockRejectedValue(new Error('timed out'));

            const p = new OpenAIProvider(baseSettings);
            const result = await p.generateSummary('content');
            expect(result.summary).toContain('timed out');
        });

        test('blocks on HIGH prompt-injection danger level', async () => {
            sanitizePromptContent.mockReturnValueOnce({
                sanitized: 'x', warnings: ['attack'], dangerLevel: 'high'
            });

            const p = new OpenAIProvider(baseSettings);
            const result = await p.generateSummary('malicious');
            expect(result.summary).toContain('security risk');
        });

        test('returns a schema error when choices is empty', async () => {
            (fetchWithRetry as Mock).mockResolvedValue({
                ok: true,
                json: async () => ({ choices: [] })
            });

            const p = new OpenAIProvider(baseSettings);
            const result = await p.generateSummary('content');
            expect(result.success).toBe(false);
            expect(result.summary).toContain('Error: Invalid API response format');
            expect(result.error).toContain('choices is missing or empty');
        });

        test('returns a schema error when message.content is missing', async () => {
            (fetchWithRetry as Mock).mockResolvedValue({
                ok: true,
                json: async () => ({ choices: [{ message: { role: 'assistant' } }] })
            });

            const p = new OpenAIProvider(baseSettings);
            const result = await p.generateSummary('content');
            expect(result.success).toBe(false);
            expect(result.summary).toContain('Error: Invalid API response format');
            expect(result.error).toContain('message.content is not a string');
        });

        test('truncates content to 4000 characters for local URLs', async () => {
            (fetchWithRetry as Mock).mockResolvedValue({
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

            const body = JSON.parse((fetchWithRetry as Mock).mock.calls[0]![1].body);
            const userPrompt = body.messages[1].content as string;
            // 4000文字を超えたコンテンツは送られない
            expect(userPrompt.length).toBeLessThanOrEqual(4200); // プロンプトテンプレート分の余裕を含む
        });

        test('truncates content to 10000 characters for cloud URLs', async () => {
            (fetchWithRetry as Mock).mockResolvedValue({
                ok: true,
                json: async () => ({ choices: [{ message: { content: 'OK' } }] })
            });

            const p = new OpenAIProvider(baseSettings);

            // 15000文字のコンテンツを送る
            const longContent = 'a'.repeat(15000);
            await p.generateSummary(longContent);

            const body = JSON.parse((fetchWithRetry as Mock).mock.calls[0]![1].body);
            const userPrompt = body.messages[1].content as string;
            // 10000文字を超えたコンテンツは送られない
            expect(userPrompt.length).toBeLessThanOrEqual(10200);
        });

        test('overrides the truncation length with the openai_content_chars setting', async () => {
            (fetchWithRetry as Mock).mockResolvedValue({
                ok: true,
                json: async () => ({ choices: [{ message: { content: 'OK' } }] })
            });

            const p = new OpenAIProvider({
                ...baseSettings,
                openai_content_chars: 15000
            });
            const longContent = 'b'.repeat(20_000);
            await p.generateSummary(longContent);

            const body = JSON.parse((fetchWithRetry as Mock).mock.calls[0]![1].body);
            const userPrompt = body.messages[1].content as string;
            // 15000文字の制限に従い、プロンプトテンプレート分の余裕を含む
            expect(userPrompt.length).toBeLessThanOrEqual(15200);
        });

        test('records usage on success', async () => {
            (fetchWithRetry as Mock).mockResolvedValue({
                ok: true,
                json: async () => ({
                    choices: [{ message: { content: 'Summary result' } }],
                    usage: { prompt_tokens: 10, completion_tokens: 5 }
                })
            });

            const p = new OpenAIProvider(baseSettings);
            await p.generateSummary('content');

            expect(recordUsage).toHaveBeenCalledWith(10, 5);
        });

        test('does not record usage when usage is missing', async () => {
            (fetchWithRetry as Mock).mockResolvedValue({
                ok: true,
                json: async () => ({ choices: [{ message: { content: 'OK' } }] })
            });

            const p = new OpenAIProvider(baseSettings);
            await p.generateSummary('content');

            expect(recordUsage).not.toHaveBeenCalled();
        });

        test('strips the trailing slash from baseUrl', async () => {
            (fetchWithRetry as Mock).mockResolvedValue({
                ok: true,
                json: async () => ({ choices: [{ message: { content: 'OK' } }] })
            });

            const p = new OpenAIProvider({ ...baseSettings, openai_base_url: 'https://api.openai.com/v1/' });
            await p.generateSummary('content');

            const url = (fetchWithRetry as Mock).mock.calls[0]![0];
            expect(url).toBe('https://api.openai.com/v1/chat/completions');
            expect(url).not.toContain('v1//chat');
        });
    });

    describe('testConnection', () => {
        test('tests with the default URL when baseUrl is not set', async () => {
            (fetchWithRetry as Mock).mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ choices: [{ message: { content: 'OK' } }] }),
            });

            const p = new OpenAIProvider({ ...baseSettings, openai_base_url: '' });
            const result = await p.testConnection();
            expect(result.success).toBe(true);
        });

        test('succeeds on a successful connection', async () => {
            (fetchWithRetry as Mock).mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ choices: [{ message: { content: 'OK' } }] }),
            });

            const p = new OpenAIProvider(baseSettings);
            const result = await p.testConnection();
            expect(result.success).toBe(true);
        });

        test('returns an authentication error on 401', async () => {
            (fetchWithRetry as Mock).mockResolvedValue({ ok: false, status: 401 });

            const p = new OpenAIProvider(baseSettings);
            const result = await p.testConnection();
            expect(result.success).toBe(false);
            expect(result.message).toContain('Authentication failed');
        });

        test('returns an endpoint-not-found error on 404', async () => {
            (fetchWithRetry as Mock).mockResolvedValue({ ok: false, status: 404 });

            const p = new OpenAIProvider(baseSettings);
            const result = await p.testConnection();
            expect(result.success).toBe(false);
            expect(result.message).toContain('not found');
        });

        test('returns a rate-limit error on 429', async () => {
            (fetchWithRetry as Mock).mockResolvedValue({ ok: false, status: 429 });

            const p = new OpenAIProvider(baseSettings);
            const result = await p.testConnection();
            expect(result.success).toBe(false);
            expect(result.message).toContain('Rate limit');
        });

        test('returns Cannot connect on a network error', async () => {
            (fetchWithRetry as Mock).mockRejectedValue(new Error('Failed to fetch'));

            const p = new OpenAIProvider(baseSettings);
            const result = await p.testConnection();
            expect(result.success).toBe(false);
            expect(result.message).toContain('Cannot connect');
        });

        test('returns a timeout error message on timeout', async () => {
            (fetchWithRetry as Mock).mockRejectedValue(new Error('timeout'));

            const p = new OpenAIProvider(baseSettings);
            const result = await p.testConnection();
            expect(result.success).toBe(false);
            expect(result.message).toContain('timeout');
        });

        test('returns a timeout message on AbortError', async () => {
            const abortError = new Error('The operation was aborted');
            abortError.name = 'AbortError';
            (fetchWithRetry as Mock).mockRejectedValue(abortError);

            const p = new OpenAIProvider(baseSettings);
            const result = await p.testConnection();
            expect(result.success).toBe(false);
            expect(result.message).toContain('timed out');
        });

        test('returns an endpoint-not-found error on a thrown HTTP 404 error', async () => {
            (fetchWithRetry as Mock).mockRejectedValue(new Error('HTTP 404: Not Found'));

            const p = new OpenAIProvider(baseSettings);
            const result = await p.testConnection();
            expect(result.success).toBe(false);
            expect(result.message).toContain('not found');
        });
    });
});
