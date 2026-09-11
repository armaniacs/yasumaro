/**
 * GeminiProvider.test.ts
 * GeminiProvider.ts の単体テスト
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

      getAllowedUrls: vi.fn(async () => new Set(['https://generativelanguage.googleapis.com'])),
      StorageKeys: {
          MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
          CUSTOM_PROMPTS: 'custom_prompts',
          AI_TIMEOUT_MS: 'ai_timeout_ms',
          GEMINI_API_VERSION: 'gemini_api_version',
          GEMINI_CONTENT_CHARS: 'gemini_content_chars'
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

      getAllowedUrls: vi.fn(async () => new Set(['https://generativelanguage.googleapis.com'])),
      StorageKeys: {
          MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
          CUSTOM_PROMPTS: 'custom_prompts',
          AI_TIMEOUT_MS: 'ai_timeout_ms',
          GEMINI_API_VERSION: 'gemini_api_version',
          GEMINI_CONTENT_CHARS: 'gemini_content_chars'
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

      getAllowedUrls: vi.fn(async () => new Set(['https://generativelanguage.googleapis.com'])),
      StorageKeys: {
          MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
          CUSTOM_PROMPTS: 'custom_prompts',
          AI_TIMEOUT_MS: 'ai_timeout_ms',
          GEMINI_API_VERSION: 'gemini_api_version',
          GEMINI_CONTENT_CHARS: 'gemini_content_chars'
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

      getAllowedUrls: vi.fn(async () => new Set(['https://generativelanguage.googleapis.com'])),
      StorageKeys: {
          MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
          CUSTOM_PROMPTS: 'custom_prompts',
          AI_TIMEOUT_MS: 'ai_timeout_ms',
          GEMINI_API_VERSION: 'gemini_api_version',
          GEMINI_CONTENT_CHARS: 'gemini_content_chars'
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

      getAllowedUrls: vi.fn(async () => new Set(['https://generativelanguage.googleapis.com'])),
      StorageKeys: {
          MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
          CUSTOM_PROMPTS: 'custom_prompts',
          AI_TIMEOUT_MS: 'ai_timeout_ms',
          GEMINI_API_VERSION: 'gemini_api_version',
          GEMINI_CONTENT_CHARS: 'gemini_content_chars'
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

      getAllowedUrls: vi.fn(async () => new Set(['https://generativelanguage.googleapis.com'])),
      StorageKeys: {
          MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
          CUSTOM_PROMPTS: 'custom_prompts',
          AI_TIMEOUT_MS: 'ai_timeout_ms',
          GEMINI_API_VERSION: 'gemini_api_version',
          GEMINI_CONTENT_CHARS: 'gemini_content_chars'
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
        test('sets the API key and model from settings', () => {
            const provider = new GeminiProvider(baseSettings);
            expect(provider.getName()).toBe('gemini');
        });

        test('uses an empty string when no API key is set', () => {
            const provider = new GeminiProvider({ ...baseSettings, gemini_api_key: '' });
            expect(provider.getName()).toBe('gemini');
        });

        test('uses the default model when no model is configured', () => {
            const provider = new GeminiProvider({ gemini_api_key: 'key' });
            expect(provider.getName()).toBe('gemini');
        });

        test('uses the configured timeout', () => {
            const provider = new GeminiProvider({ ...baseSettings, ai_timeout_ms: 60000 });
            expect((provider as unknown as { timeoutMs: number }).timeoutMs).toBe(60000);
        });

        test('defaults to 30000 when no timeout is configured', () => {
            const provider = new GeminiProvider(baseSettings);
            expect((provider as unknown as { timeoutMs: number }).timeoutMs).toBe(30000);
        });

        test('passes the configured timeout to the request', async () => {
            (fetchWithRetry as Mock).mockResolvedValue({
                ok: true,
                json: async () => ({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] })
            });

            const provider = new GeminiProvider({ ...baseSettings, ai_timeout_ms: 60000 });
            await provider.generateSummary('content');

            const options = (fetchWithRetry as Mock).mock.calls[0]![1];
            expect(options.timeoutMs).toBe(60000);
        });
    });

    describe('getName', () => {
        test('returns gemini', () => {
            const provider = new GeminiProvider(baseSettings);
            expect(provider.getName()).toBe('gemini');
        });
    });

    describe('generateSummary', () => {
        test('returns an error message when the API key is missing', async () => {
            const provider = new GeminiProvider({ ...baseSettings, gemini_api_key: '' });
            const result = await provider.generateSummary('content');

            expect(result.summary).toContain('API key is missing');
        });

        test('returns an error message on rate limiting', async () => {
            checkRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, resetTime: 30 });

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.generateSummary('content');

            expect(result.summary).toContain('Rate limited');
        });

        test('returns a summary on success', async () => {
            (fetchWithRetry as Mock).mockResolvedValue({
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

        test('includes providerName and model in the success result', async () => {
            (fetchWithRetry as Mock).mockResolvedValue({
                ok: true,
                json: async () => ({
                    candidates: [{ content: { parts: [{ text: 'Summary' }] } }],
                    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 }
                })
            });

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.generateSummary('content');

            expect(result.providerName).toBe('gemini');
            expect(result.modelName).toBe('gemini-3.1-flash-lite');
        });

        test('returns an error message on an API error response', async () => {
            (fetchWithRetry as Mock).mockResolvedValue({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error'
            });

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.generateSummary('content');

            expect(result.summary).toContain('Error');
        });

        test('returns a model-not-found message on 404', async () => {
            (fetchWithRetry as Mock).mockResolvedValue({
                ok: false,
                status: 404
            });

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.generateSummary('content');

            expect(result.summary).toContain('Model not found');
        });

        test('returns a timeout message on a timeout error', async () => {
            (fetchWithRetry as Mock).mockRejectedValue(new Error('Request timed out'));

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.generateSummary('content');

            expect(result.summary).toContain('timed out');
        });

        test('blocks on HIGH prompt-injection danger level', async () => {
            sanitizePromptContent.mockReturnValueOnce({
                sanitized: 'blocked',
                warnings: ['injection'],
                dangerLevel: 'high'
            });

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.generateSummary('malicious');

            expect(result.summary).toContain('security risk');
        });

        test('returns a schema error when candidates is empty', async () => {
            (fetchWithRetry as Mock).mockResolvedValue({
                ok: true,
                json: async () => ({ candidates: [] })
            });

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.generateSummary('content');

            expect(result.success).toBe(false);
            expect(result.summary).toContain('Error: Invalid API response format');
            expect(result.error).toContain('candidates is missing or empty');
        });

        test('fails as an empty response when parts has no text', async () => {
            (fetchWithRetry as Mock).mockResolvedValue({
                ok: true,
                json: async () => ({
                    candidates: [{ content: { parts: [{ role: 'model' }] } }]
                })
            });

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.generateSummary('content');

            expect(result.success).toBe(false);
            expect(result.summary).toContain('empty response');
            expect(result.error).toContain('no text');
        });

        test('returns a settings-change prompt message when the body is empty with MAX_TOKENS', async () => {
            // Gemini 2.5系以降は thinking が maxOutputTokens を消費するため、
            // 枠が足りないと本文が空のまま MAX_TOKENS で返る
            (fetchWithRetry as Mock).mockResolvedValue({
                ok: true,
                json: async () => ({
                    candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }],
                    usageMetadata: { promptTokenCount: 7, thoughtsTokenCount: 1000 }
                })
            });

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.generateSummary('content');

            expect(result.success).toBe(false);
            expect(result.summary).toContain('max tokens');
            expect(result.error).toContain('finishReason=MAX_TOKENS');
            expect(result.error).toContain('thoughtsTokens=1000');
        });

        test('strips the models/ prefix from the model name', async () => {
            (fetchWithRetry as Mock).mockResolvedValue({
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

            const callUrl = (fetchWithRetry as Mock).mock.calls[0]![0];
            expect(callUrl).toContain('gemini-pro:generateContent');
            expect(callUrl).not.toContain('models/models/');
        });

        test('includes systemInstruction in the payload', async () => {
            (fetchWithRetry as Mock).mockResolvedValue({
                ok: true,
                json: async () => ({
                    candidates: [{ content: { parts: [{ text: 'Summary' }] } }],
                    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 }
                })
            });

            const provider = new GeminiProvider(baseSettings);
            await provider.generateSummary('content');

            const options = (fetchWithRetry as Mock).mock.calls[0]![1];
            const body = JSON.parse(options.body);
            expect(body.systemInstruction).toBeDefined();
            expect(body.systemInstruction.parts[0].text).toBe('You are a helpful assistant.');
        });

        test('uses the default system prompt when systemPrompt is empty', async () => {
            (applyCustomPrompt as Mock).mockReturnValueOnce({
                userPrompt: 'Summarize: content',
                systemPrompt: '',
                isCustom: false
            });
            (fetchWithRetry as Mock).mockResolvedValue({
                ok: true,
                json: async () => ({
                    candidates: [{ content: { parts: [{ text: 'Summary' }] } }],
                    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 }
                })
            });

            const provider = new GeminiProvider(baseSettings);
            await provider.generateSummary('content');

            const options = (fetchWithRetry as Mock).mock.calls[0]![1];
            const body = JSON.parse(options.body);
            expect(body.systemInstruction.parts[0].text).toBe('Default system prompt.');
        });
    });

    describe('testConnection', () => {
        test('returns an error when the API key is missing', async () => {
            const provider = new GeminiProvider({ ...baseSettings, gemini_api_key: '' });
            const result = await provider.testConnection();

            expect(result.success).toBe(false);
            expect(result.message).toContain('not set');
        });

        test('succeeds on a successful connection', async () => {
            (validateUrlForAIRequests as Mock).mockImplementation(() => {});
            (fetchWithRetry as Mock).mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] }),
            });

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.testConnection();

            expect(result.success).toBe(true);
            expect(result.message).toContain('Connected');
        });

        test('returns an authentication-failure message on 401', async () => {
            (validateUrlForAIRequests as Mock).mockImplementation(() => {});
            (fetchWithRetry as Mock).mockResolvedValue({
                ok: false,
                status: 401,
                statusText: 'Unauthorized'
            });

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.testConnection();

            expect(result.success).toBe(false);
            expect(result.message).toContain('Authentication failed');
        });

        test('returns a rate-limit message on 429', async () => {
            (validateUrlForAIRequests as Mock).mockImplementation(() => {});
            (fetchWithRetry as Mock).mockResolvedValue({
                ok: false,
                status: 429,
                statusText: 'Too Many Requests'
            });

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.testConnection();

            expect(result.success).toBe(false);
            expect(result.message).toContain('Rate limit');
        });

        test('returns a network error message on a timeout error', async () => {
            (validateUrlForAIRequests as Mock).mockImplementation(() => {});
            (fetchWithRetry as Mock).mockRejectedValue(new Error('timeout'));

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.testConnection();

            expect(result.success).toBe(false);
            expect(result.message).toContain('timeout');
        });

        test('returns an error message on a generic error', async () => {
            (validateUrlForAIRequests as Mock).mockImplementation(() => {});
            (fetchWithRetry as Mock).mockRejectedValue(new Error('Network error'));

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.testConnection();

            expect(result.success).toBe(false);
            expect(result.message).toContain('Network error');
        });

        test('returns a timeout message on AbortError', async () => {
            (validateUrlForAIRequests as Mock).mockImplementation(() => {});
            const abortError = new Error('The operation was aborted');
            abortError.name = 'AbortError';
            (fetchWithRetry as Mock).mockRejectedValue(abortError);

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.testConnection();

            expect(result.success).toBe(false);
            expect(result.message).toContain('timed out');
        });

        test('returns an invalid-API-key message on a thrown HTTP 401 error', async () => {
            (validateUrlForAIRequests as Mock).mockImplementation(() => {});
            (fetchWithRetry as Mock).mockRejectedValue(new Error('HTTP 401: Unauthorized'));

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.testConnection();

            expect(result.success).toBe(false);
            expect(result.message).toContain('Invalid API key');
        });

        test('returns a model-not-found message on a thrown HTTP 404 error', async () => {
            (validateUrlForAIRequests as Mock).mockImplementation(() => {});
            (fetchWithRetry as Mock).mockRejectedValue(new Error('HTTP 404: Not Found'));

            const provider = new GeminiProvider(baseSettings);
            const result = await provider.testConnection();

            expect(result.success).toBe(false);
            expect(result.message).toContain('not found');
        });

    describe('API version configurability', () => {
        test('testConnection uses the configured API version', async () => {
            (fetchWithRetry as Mock).mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] })
            });

            const provider = new GeminiProvider({
                ...baseSettings,
                gemini_api_version: 'v1'
            });

            await provider.testConnection();

            // 接続テストは実際に推論を走らせるため :generateContent を叩く
            const url = (fetchWithRetry as Mock).mock.calls[0]![0];
            expect(url).toBe('https://generativelanguage.googleapis.com/v1/models/gemini-3.1-flash-lite:generateContent');
        });

        test('overrides the API URL version with the gemini_api_version setting', async () => {
            (fetchWithRetry as Mock).mockResolvedValue({
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

            const url = (fetchWithRetry as Mock).mock.calls[0]![0];
            expect(url).toContain('/v1/models/');
            expect(url).not.toContain('/v1beta/models/');
        });

        test('uses the default v1beta when gemini_api_version is not set', async () => {
            (fetchWithRetry as Mock).mockResolvedValue({
                ok: true,
                json: async () => ({
                    candidates: [{ content: { parts: [{ text: 'summary' }] } }],
                    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 }
                })
            });

            const provider = new GeminiProvider(baseSettings);

            await provider.generateSummary('content');

            const url = (fetchWithRetry as Mock).mock.calls[0]![0];
            expect(url).toContain('/v1beta/models/');
        });
    });

    describe('content length truncation', () => {
        test('truncates to 30,000 characters by default', async () => {
            (fetchWithRetry as Mock).mockResolvedValue({
                ok: true,
                json: async () => ({
                    candidates: [{ content: { parts: [{ text: 'summary' }] } }],
                    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 }
                })
            });

            const provider = new GeminiProvider(baseSettings);
            const longContent = 'a'.repeat(40_000);

            await provider.generateSummary(longContent);

            const body = JSON.parse((fetchWithRetry as Mock).mock.calls[0]![1].body);
            const userContent = body.contents[0].parts[0].text as string;
            const actualContent = userContent.replace(/^Summarize: /, '');
            expect(actualContent.length).toBe(30_000);
        });

        test('overrides the truncation length with the gemini_content_chars setting', async () => {
            (fetchWithRetry as Mock).mockResolvedValue({
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

            const body = JSON.parse((fetchWithRetry as Mock).mock.calls[0]![1].body);
            const userContent = body.contents[0].parts[0].text as string;
            const actualContent = userContent.replace(/^Summarize: /, '');
            expect(actualContent.length).toBe(20_000);
        });
    });
    });
});
