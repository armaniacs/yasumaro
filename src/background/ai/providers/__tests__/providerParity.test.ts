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
import { readFileSync } from 'node:fs';
import { Crypto } from '@peculiar/webcrypto';

Object.defineProperty(global, 'crypto', { value: new Crypto() });

const mockRecordUsage = vi.fn();

vi.mock('../../../../utils/fetch.js', () => ({
  fetchWithRetry: vi.fn(),
  fetchWithTimeout: vi.fn(),
  validateUrlForAIRequests: vi.fn(),
  CONNECTION_TEST_CACHE_MODE: 'no-store',
}));

vi.mock('../../../../utils/logger/types.js', () => ({
  addLog: vi.fn(),
  LogType: { ERROR: 'error', WARN: 'warn', INFO: 'info', DEBUG: 'debug' },
}));
vi.mock('../../../../utils/logger/core.js', () => ({
  addLog: vi.fn(),
  LogType: { ERROR: 'error', WARN: 'warn', INFO: 'info', DEBUG: 'debug' },
}));
vi.mock('../../../../utils/logger/api.js', () => ({
  logDebug: vi.fn(),
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
import { BuiltInAiProvider } from '../BuiltInAiProvider.js';
import { GeminiProvider, GEMINI_PINNED_ORIGIN } from '../GeminiProvider.js';
import { OpenAIProvider } from '../OpenAIProvider.js';
import { FAILURE_KINDS, FailureKind } from '../../../../utils/failureTaxonomy.js';
import type { BuiltInAISummarizer } from '../BuiltInAiProvider.js';
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
  // Non-local custom origins require the explicit user confirmation record
  // (VULN-002 origin authorization).
  confirmed_provider_origins: { provider_base_url: ['https://api.example.com'] },
} as unknown as Settings;

const builtInSettings = {} as Settings;

/** A successful on-device summarizer; the on-device provider takes no request. */
function builtInProvider(
  result: Record<string, unknown> = { success: true, summary: 'ok' },
): BuiltInAiProvider {
  return new BuiltInAiProvider(builtInSettings, {
    summarize: vi.fn(async () => result),
  });
}

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
  // Only the two HTTP providers reach the transport, so only they can install a
  // retry predicate; BuiltIn issues no request and is covered by the
  // no-transport parity below.
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

  it.each(cases)('$name passes a retry predicate', async ({ run }) => {
    await run();
    // Regression: GeminiProvider used to omit shouldRetry entirely.
    expect(retryOptions().shouldRetry).toBeTypeOf('function');
  });

  it.each(cases)('$name does not retry on 429', async ({ run }) => {
    await run();
    const shouldRetry = retryOptions().shouldRetry!;
    expect(shouldRetry(new Error('rate limited'), 1, httpResponse(429), 'POST')).toBe(false);
  });

  it.each(cases)('$name does not retry a non-idempotent POST 5xx', async ({ run }) => {
    await run();
    const shouldRetry = retryOptions().shouldRetry!;
    expect(shouldRetry(new Error('server error'), 1, httpResponse(503), 'POST')).toBe(false);
  });

  it.each(cases)('$name retries on a network error', async ({ run }) => {
    await run();
    const shouldRetry = retryOptions().shouldRetry!;
    const err = new Error('fetch failed');
    expect(shouldRetry(err, 1, null, 'POST')).toBe(true);
  });

  // The on-device provider's parity statement: it owns no request, so it has no
  // retry policy to diverge on — and it must not reach the HTTP transport.
  it('BuiltIn: issues no request, so there is no retry policy to diverge on', async () => {
    const result = await builtInProvider().generateSummary('content');

    expect(result.success).toBe(true);
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});

/**
 * One row per provider, one shape: a successful summary produced through that
 * provider's own seam. `withUsage` decides whether the payload carries token
 * counts, so the recording rule can be asserted identically for all three.
 */
const usageCases = [
  {
    name: 'Gemini',
    run: (withUsage: boolean) => {
      mockedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'ok' }] } }],
          ...(withUsage ? { usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 3 } } : {}),
        }),
      } as unknown as Response);
      return new GeminiProvider(geminiSettings).generateSummary('content');
    },
  },
  {
    name: 'OpenAI-compatible',
    run: (withUsage: boolean) => {
      mockedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'ok' } }],
          ...(withUsage ? { usage: { prompt_tokens: 11, completion_tokens: 3 } } : {}),
        }),
      } as unknown as Response);
      return new OpenAIProvider(openAiSettings, 'openai-compatible').generateSummary('content');
    },
  },
  {
    name: 'BuiltIn',
    run: (withUsage: boolean) =>
      builtInProvider({
        success: true,
        summary: 'ok',
        ...(withUsage ? { sentTokens: 11, receivedTokens: 3 } : {}),
      }).generateSummary('content'),
  },
];

describe('使用量記録は全プロバイダーで揃っている', () => {
  it.each(usageCases)('$name: skips recording when usage is missing', async ({ run }) => {
    await run(false);

    // Regression: Gemini used to record a bogus (0, 0) row for unknown usage.
    expect(mockRecordUsage).not.toHaveBeenCalled();
  });

  it.each(usageCases)('$name: records usage when usage is present', async ({ run }) => {
    await run(true);

    expect(mockRecordUsage).toHaveBeenCalledWith(11, 3);
  });
});

/** Make the transport answer 200 with the given body. */
function respondWith(body: unknown): void {
  mockedFetch.mockResolvedValue({ ok: true, json: async () => body } as unknown as Response);
}

/** The first request URL the transport was asked for. */
function requestedUrl(): string {
  expect(mockedFetch).toHaveBeenCalled();
  return mockedFetch.mock.calls[0]![0] as unknown as string;
}

describe('失敗契約は全プロバイダーで揃っている', () => {
  // Missing credentials: no request is made and no retry can fix it, so every
  // flow that guards a credential must report a configuration failure.
  const credentialCases = [
    {
      name: 'Gemini 要約',
      run: () => new GeminiProvider({ ...geminiSettings, gemini_api_key: '' } as unknown as Settings).generateSummary('c'),
      kindOf: (r: { failure?: { kind: string } }) => r.failure?.kind,
    },
    {
      name: 'Gemini テスト',
      run: () => new GeminiProvider({ ...geminiSettings, gemini_api_key: '' } as unknown as Settings).testConnection(),
      kindOf: (r: { debug?: { failure?: { kind: string } } }) => r.debug?.failure?.kind,
    },
    {
      name: 'OpenAI互換 要約',
      run: () => new OpenAIProvider({ provider_model: 'm' } as unknown as Settings, 'openai-compatible').generateSummary('c'),
      kindOf: (r: { failure?: { kind: string } }) => r.failure?.kind,
    },
    {
      name: 'OpenAI互換 テスト',
      run: () => new OpenAIProvider({ provider_model: 'm' } as unknown as Settings, 'openai-compatible').testConnection(),
      kindOf: (r: { debug?: { failure?: { kind: string } } }) => r.debug?.failure?.kind,
    },
  ];

  it.each(credentialCases)('$name は credential 欠如を configuration として返す', async ({ run, kindOf }) => {
    const result = await run();

    expect(kindOf(result as never)).toBe(FailureKind.CONFIGURATION);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  const invalidModelCases = [
    {
      name: 'Gemini 要約',
      run: () => new GeminiProvider({ ...geminiSettings, gemini_model: '../../etc/passwd' } as unknown as Settings).generateSummary('c'),
      kindOf: (r: { failure?: { kind: string } }) => r.failure?.kind,
    },
    {
      name: 'Gemini テスト',
      run: () => new GeminiProvider({ ...geminiSettings, gemini_model: '../../etc/passwd' } as unknown as Settings).testConnection(),
      kindOf: (r: { debug?: { failure?: { kind: string } } }) => r.debug?.failure?.kind,
    },
  ];

  it.each(invalidModelCases)('$name は model 名不正を configuration として返す', async ({ run, kindOf }) => {
    const result = await run();

    expect(kindOf(result as never)).toBe(FailureKind.CONFIGURATION);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('OpenAI互換: 空文字の要約を schema 失敗と同じ kind で拒否する', async () => {
    respondWith({ choices: [{ message: { content: '   ' } }] });

    const result = await new OpenAIProvider(openAiSettings, 'openai-compatible').generateSummary('content');

    // Same condition and sentence as the test path, so the two flows cannot
    // disagree about whether an empty body is a summary.
    expect(result.success).toBe(false);
    expect(result.summary).toBe('Error: Response contained no content.');
    expect(result.failure?.kind).toBe(FailureKind.HTTP);
  });

  it('OpenAI互換: 空文字の要約は接続テストと同じ文面で拒否する', async () => {
    respondWith({ choices: [{ message: { content: '' } }] });

    const summaryResult = await new OpenAIProvider(openAiSettings, 'openai-compatible').generateSummary('content');
    const testResult = await new OpenAIProvider(openAiSettings, 'openai-compatible').testConnection();

    const summarySentence = summaryResult.summary.replace(/^Error: /, '');
    expect(summarySentence).toBe(testResult.message);
  });

  it('BuiltIn: 例外文を summary に出さず固定文と error に分離する', async () => {
    const provider = new BuiltInAiProvider(builtInSettings, {
      summarize: vi.fn(async () => {
        throw new Error('LanguageModel is not defined at window.__ai');
      }),
    });

    const result = await provider.generateSummary('content');

    expect(result.success).toBe(false);
    expect(result.summary).toBe('Error: Failed to generate summary. Please try again or check your settings.');
    expect(result.summary).not.toContain('__ai');
    expect(result.error).toBe('LanguageModel is not defined at window.__ai');
    expect(result.failure?.kind).toBe(FailureKind.CONFIGURATION);
  });

  it('BuiltIn: client が失敗を返した経路も kind を持つ', async () => {
    const summaryResult = await builtInProvider({ success: false, error: 'downloadable' }).generateSummary('content');
    const testResult = await builtInProvider({ success: false, error: 'downloadable' }).testConnection();

    expect(summaryResult.failure?.kind).toBe(FailureKind.CONFIGURATION);
    expect(testResult.debug?.failure?.kind).toBe(FailureKind.CONFIGURATION);
  });

  // Every kind these providers attach must be one the taxonomy declares, or the
  // breaker gate (RemoteAIService) cannot branch on it at all.
  it('添付される kind は必ず taxonomy の kind である', async () => {
    const failures: Array<{ kind: string } | undefined> = [];

    respondWith({});
    failures.push((await new GeminiProvider(geminiSettings).generateSummary('c')).failure);
    respondWith({});
    failures.push((await new OpenAIProvider(openAiSettings, 'openai-compatible').generateSummary('c')).failure);
    failures.push((await new GeminiProvider({ ...geminiSettings, gemini_api_key: '' } as unknown as Settings)
      .generateSummary('c')).failure);
    respondWith({ choices: [{ message: { content: '' } }] });
    failures.push((await new OpenAIProvider(openAiSettings, 'openai-compatible').generateSummary('c')).failure);
    failures.push((await builtInProvider({ success: false, error: 'x' }).generateSummary('c')).failure);

    expect(failures.length).toBe(5);
    for (const failure of failures) {
      expect(failure).toBeDefined();
      expect(FAILURE_KINDS).toContain(failure!.kind);
    }
  });
});

describe('Gemini の接続先は pinned origin から導出される', () => {
  it('要約フローの URL が pinned origin から始まる', async () => {
    respondWith({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] });

    await new GeminiProvider(geminiSettings).generateSummary('content');

    expect(requestedUrl().startsWith(`${GEMINI_PINNED_ORIGIN}/`)).toBe(true);
  });

  it('テストフローの URL が要約フローと同じ origin を使う', async () => {
    respondWith({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
    const summaryUrl = (await new GeminiProvider(geminiSettings).generateSummary('content'), requestedUrl());

    mockedFetch.mockClear();
    respondWith({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
    await new GeminiProvider(geminiSettings).testConnection();
    const testUrl = requestedUrl();

    expect(testUrl.startsWith(`${GEMINI_PINNED_ORIGIN}/`)).toBe(true);
    // Same origin, so the authorized origin and the request target cannot drift.
    expect(new URL(testUrl).origin).toBe(new URL(summaryUrl).origin);
  });

  // A behavioural assertion cannot tell an identical literal from a derived
  // value, and the derivation IS the contract: the origin the constructor
  // authorizes must be the only spelling of that origin in the file, or the
  // two can drift apart again on the next edit.
  it('pinned origin リテラルは定数の定義にしか現れない', () => {
    const source = readFileSync(new URL('../GeminiProvider.ts', import.meta.url), 'utf8');
    const occurrences = source.split(GEMINI_PINNED_ORIGIN).length - 1;

    expect(occurrences).toBe(1);
  });
});
