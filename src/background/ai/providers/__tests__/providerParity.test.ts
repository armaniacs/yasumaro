/**
 * providerParity.test.ts
 * PBI 2026-08-08-05: AI プロバイダー間の非対称な振る舞いを解消する
 *
 * 同じ「AI要約」でありながら OpenAI と Gemini で挙動が違っていた2点を固定する。
 *
 * 1. リトライ方針:
 *    OpenAI は 429 と非冪等 5xx を抑止する shouldRetry を渡していたが、
 *    Gemini は渡しておらずデフォルトを継承していた。つまり Gemini だけが
 *    レート制限に当たってもリトライし、制限を悪化させていた。
 *
 * 2. 使用量記録:
 *    OpenAI はトークン数が取れない場合に記録しないが、Gemini は || 0 で
 *    0 に丸めて必ず recordUsage(0, 0) を記録していた。
 *    「トークン数不明」は「0トークン使った」ではない。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { webcrypto as crypto } from '@peculiar/webcrypto';
Object.defineProperty(global, 'crypto', { value: crypto });

const mockRecordUsage = vi.fn();

vi.mock('../../../../utils/fetch.js', () => ({
  fetchWithRetry: vi.fn(),
  fetchWithTimeout: vi.fn(),
  validateUrlForAIRequests: vi.fn(),
  CONNECTION_TEST_CACHE_MODE: 'no-store',
}));

vi.mock('../../../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: { ERROR: 'error', WARN: 'warn', INFO: 'info', DEBUG: 'debug' },
}));

vi.mock('../../../../utils/aiUsageTracker.js', () => ({
  recordUsage: (...args: unknown[]) => mockRecordUsage(...args),
  checkHardLimit: vi.fn().mockResolvedValue({ exceeded: false }),
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  checkUsageWarning: vi.fn().mockResolvedValue({ warning: false }),
  getRateLimitMessage: vi.fn(() => 'rate limited'),
}));

vi.mock('../../../../utils/promptSanitizer.js', () => ({
  sanitizePromptContent: vi.fn((c: string) => ({ sanitized: c, warnings: [], dangerLevel: 'none' })),
}));

vi.mock('../../../../utils/customPromptUtils.js', () => ({
  applyCustomPrompt: vi.fn((_settings: unknown, _provider: string, content: string) => ({
    userPrompt: `Summarize: ${content}`,
    systemPrompt: 'You are a helpful assistant.',
    isCustom: false,
  })),
  getDefaultSystemPrompt: vi.fn(() => 'Default system prompt.'),
}));

vi.mock('../../../../utils/storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    getAllowedUrls: vi.fn(async () => null),
    getSettings: vi.fn(async () => ({})),
    StorageKeys: {
      PROVIDER_BASE_URL: 'provider_base_url',
      PROVIDER_API_KEY: 'provider_api_key',
      PROVIDER_MODEL: 'provider_model',
      GEMINI_API_KEY: 'gemini_api_key',
      GEMINI_MODEL: 'gemini_model',
      GEMINI_API_VERSION: 'gemini_api_version',
      MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
    },
    Settings: {},

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
vi.mock('../../../../utils/storage/defaults.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    getAllowedUrls: vi.fn(async () => null),
    getSettings: vi.fn(async () => ({})),
    StorageKeys: {
      PROVIDER_BASE_URL: 'provider_base_url',
      PROVIDER_API_KEY: 'provider_api_key',
      PROVIDER_MODEL: 'provider_model',
      GEMINI_API_KEY: 'gemini_api_key',
      GEMINI_MODEL: 'gemini_model',
      GEMINI_API_VERSION: 'gemini_api_version',
      MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
    },
    Settings: {},

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
vi.mock('../../../../utils/storage/encryptionSession.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    getAllowedUrls: vi.fn(async () => null),
    getSettings: vi.fn(async () => ({})),
    StorageKeys: {
      PROVIDER_BASE_URL: 'provider_base_url',
      PROVIDER_API_KEY: 'provider_api_key',
      PROVIDER_MODEL: 'provider_model',
      GEMINI_API_KEY: 'gemini_api_key',
      GEMINI_MODEL: 'gemini_model',
      GEMINI_API_VERSION: 'gemini_api_version',
      MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
    },
    Settings: {},

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
vi.mock('../../../../utils/storage/savedUrlRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    getAllowedUrls: vi.fn(async () => null),
    getSettings: vi.fn(async () => ({})),
    StorageKeys: {
      PROVIDER_BASE_URL: 'provider_base_url',
      PROVIDER_API_KEY: 'provider_api_key',
      PROVIDER_MODEL: 'provider_model',
      GEMINI_API_KEY: 'gemini_api_key',
      GEMINI_MODEL: 'gemini_model',
      GEMINI_API_VERSION: 'gemini_api_version',
      MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
    },
    Settings: {},

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
vi.mock('../../../../utils/storage/domainFilterCache.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    getAllowedUrls: vi.fn(async () => null),
    getSettings: vi.fn(async () => ({})),
    StorageKeys: {
      PROVIDER_BASE_URL: 'provider_base_url',
      PROVIDER_API_KEY: 'provider_api_key',
      PROVIDER_MODEL: 'provider_model',
      GEMINI_API_KEY: 'gemini_api_key',
      GEMINI_MODEL: 'gemini_model',
      GEMINI_API_VERSION: 'gemini_api_version',
      MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
    },
    Settings: {},

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
vi.mock('../../../../utils/storage/quota.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    getAllowedUrls: vi.fn(async () => null),
    getSettings: vi.fn(async () => ({})),
    StorageKeys: {
      PROVIDER_BASE_URL: 'provider_base_url',
      PROVIDER_API_KEY: 'provider_api_key',
      PROVIDER_MODEL: 'provider_model',
      GEMINI_API_KEY: 'gemini_api_key',
      GEMINI_MODEL: 'gemini_model',
      GEMINI_API_VERSION: 'gemini_api_version',
      MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
    },
    Settings: {},

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

import { fetchWithRetry } from '../../../../utils/fetch.js';
import { GeminiProvider } from '../GeminiProvider.js';
import { OpenAIProvider } from '../OpenAIProvider.js';
import type { Settings } from '../../../../utils/storage/types.js';

const mockedFetch = vi.mocked(fetchWithRetry);

const geminiSettings = {
  gemini_api_key: 'test-key',
  gemini_model: 'gemini-test',
} as unknown as Settings;

const openAiSettings = {
  provider_base_url: 'https://api.example.com/v1',
  provider_api_key: 'test-key',
  provider_model: 'test-model',
} as unknown as Settings;

/** Retry options object passed to fetchWithRetry by generateSummary. */
function retryOptions(): {
  shouldRetry?: (e: Error, attempt: number, r: Response | null, m?: string) => boolean;
} {
  expect(mockedFetch).toHaveBeenCalled();
  return mockedFetch.mock.calls[0]![2] as {
    shouldRetry?: (e: Error, attempt: number, r: Response | null, m?: string) => boolean;
  };
}

function httpResponse(status: number): Response {
  return { status, ok: status < 400 } as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('リトライ方針は全プロバイダーで揃っている', () => {
  const cases = [
    {
      name: 'Gemini',
      run: async () => {
        mockedFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
        } as unknown as Response);
        await new GeminiProvider(geminiSettings).generateSummary('content');
      },
    },
    {
      name: 'OpenAI互換',
      run: async () => {
        mockedFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
        } as unknown as Response);
        await new OpenAIProvider(openAiSettings, 'openai-compatible').generateSummary('content');
      },
    },
  ];

  it.each(cases)('$name はリトライ述語を渡す', async ({ run }) => {
    await run();
    // Regression: GeminiProvider used to omit shouldRetry entirely.
    expect(retryOptions().shouldRetry).toBeTypeOf('function');
  });

  it.each(cases)('$name は429でリトライしない', async ({ run }) => {
    await run();
    const shouldRetry = retryOptions().shouldRetry!;
    expect(shouldRetry(new Error('rate limited'), 1, httpResponse(429), 'POST')).toBe(false);
  });

  it.each(cases)('$name は非冪等POSTの5xxでリトライしない', async ({ run }) => {
    await run();
    const shouldRetry = retryOptions().shouldRetry!;
    expect(shouldRetry(new Error('server error'), 1, httpResponse(503), 'POST')).toBe(false);
  });

  it.each(cases)('$name はネットワークエラーでリトライする', async ({ run }) => {
    await run();
    const shouldRetry = retryOptions().shouldRetry!;
    const err = new Error('fetch failed');
    expect(shouldRetry(err, 1, null, 'POST')).toBe(true);
  });
});

describe('使用量記録は全プロバイダーで揃っている', () => {
  it('Gemini: usageMetadata が無い場合は記録しない', async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
    } as unknown as Response);

    await new GeminiProvider(geminiSettings).generateSummary('content');

    // Regression: this used to record a bogus (0, 0) row.
    expect(mockRecordUsage).not.toHaveBeenCalled();
  });

  it('Gemini: usageMetadata がある場合は記録する', async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'ok' }] } }],
        usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 3 },
      }),
    } as unknown as Response);

    await new GeminiProvider(geminiSettings).generateSummary('content');

    expect(mockRecordUsage).toHaveBeenCalledWith(11, 3);
  });

  it('OpenAI互換: usage が無い場合は記録しない', async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    } as unknown as Response);

    await new OpenAIProvider(openAiSettings, 'openai-compatible').generateSummary('content');

    expect(mockRecordUsage).not.toHaveBeenCalled();
  });

  it('OpenAI互換: usage がある場合は記録する', async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 11, completion_tokens: 3 },
      }),
    } as unknown as Response);

    await new OpenAIProvider(openAiSettings, 'openai-compatible').generateSummary('content');

    expect(mockRecordUsage).toHaveBeenCalledWith(11, 3);
  });
});
