/**
 * providerParity.test.ts
 * PBI 2026-09-29-39: the interface is the test subject, not the two HTTP
 * providers that happened to differ.
 *
 * The file this replaces asserted the parity of OpenAI vs Gemini (a retry
 * policy one had and the other inherited, a usage row one recorded and the
 * other faked). Those two asymmetries are gone, and an assertion that compares
 * two named providers stops saying anything the moment a third one is added —
 * which is how the on-device provider came to be the only one with no row in a
 * table that claimed to be about parity.
 *
 * So every provider is one row of one table, and the contract is asserted for
 * every row alike:
 *
 * 1. Shape: a provider reaches the transport only if it is an HTTP one, and
 *    every provider is a strategy either way.
 * 2. Retry: the transport owns the predicate, so the summary flow and the
 *    connection test cannot drift apart.
 * 3. Usage: an unknown token count is not recorded — `0` is a fact about a
 *    measurement, not the absence of one.
 * 4. Failure: every attached kind is one the taxonomy declares, a missing
 *    credential is a configuration failure decided before any request, and a
 *    body that answers 200 with no text is a failed request on both flows.
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

vi.mock('../../../../utils/logger/types.js', async () =>
  (await import('../../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    addLog: 'fn',
    LogType: { ERROR: 'error', WARN: 'warn', INFO: 'info', DEBUG: 'debug' },
  }),
);
vi.mock('../../../../utils/logger/core.js', async () =>
  (await import('../../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    addLog: 'fn',
    LogType: { ERROR: 'error', WARN: 'warn', INFO: 'info', DEBUG: 'debug' },
  }),
);
vi.mock('../../../../utils/logger/api.js', async () =>
  (await import('../../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logDebug: 'fn',
    addLog: 'fn',
    LogType: { ERROR: 'error', WARN: 'warn', INFO: 'info', DEBUG: 'debug' },
  }),
);

vi.mock('../../../../utils/aiUsageTracker.js', () => ({
  recordUsage: (...args: unknown[]) => mockRecordUsage(...args),
  checkHardLimit: vi.fn().mockResolvedValue({ blocked: false }),
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

import { fetchWithRetry } from '../../../../utils/fetch.js';
import { AIProviderStrategy } from '../ProviderStrategy.js';
import { HttpProviderStrategy } from '../HttpProviderStrategy.js';
import { BuiltInAiProvider } from '../BuiltInAiProvider.js';
import { GeminiProvider, GEMINI_PINNED_ORIGIN } from '../GeminiProvider.js';
import { OpenAIProvider } from '../OpenAIProvider.js';
import { FAILURE_KINDS, FailureKind } from '../../../../utils/failureTaxonomy.js';
import type { BuiltInAiSummarizer } from '../BuiltInAiProvider.js';
import type { AISummaryResult } from '../ProviderStrategy.js';
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
  const client: BuiltInAiSummarizer = { summarize: vi.fn(async () => result) };
  return new BuiltInAiProvider(builtInSettings, client);
}

/** Make the transport answer 200 with the given body. */
function respondWith(body: unknown): void {
  mockedFetch.mockResolvedValue({ ok: true, json: async () => body } as unknown as Response);
}

/** The first request URL the transport was asked for. */
function requestedUrl(): string {
  expect(mockedFetch).toHaveBeenCalled();
  return mockedFetch.mock.calls[0]![0] as unknown as string;
}

/**
 * One row per provider, one shape. `reachesTransport` is the single difference
 * the contract may branch on: an HTTP provider issues a request, the on-device
 * one must not. `withUsage` decides whether the payload carries token counts,
 * so the recording rule reads identically for every row.
 */
const providers = [
  {
    name: 'Gemini',
    reachesTransport: true,
    create: (): AIProviderStrategy => new GeminiProvider(geminiSettings),
    summarize: (withUsage: boolean): Promise<AISummaryResult> => {
      respondWith({
        candidates: [{ content: { parts: [{ text: 'ok' }] } }],
        ...(withUsage ? { usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 3 } } : {}),
      });
      return new GeminiProvider(geminiSettings).generateSummary('content');
    },
  },
  {
    name: 'OpenAI-compatible',
    reachesTransport: true,
    create: (): AIProviderStrategy => new OpenAIProvider(openAiSettings, 'openai-compatible'),
    summarize: (withUsage: boolean): Promise<AISummaryResult> => {
      respondWith({
        choices: [{ message: { content: 'ok' } }],
        ...(withUsage ? { usage: { prompt_tokens: 11, completion_tokens: 3 } } : {}),
      });
      return new OpenAIProvider(openAiSettings, 'openai-compatible').generateSummary('content');
    },
  },
  {
    name: 'BuiltIn',
    reachesTransport: false,
    create: (): AIProviderStrategy => builtInProvider(),
    summarize: (withUsage: boolean): Promise<AISummaryResult> => builtInProvider({
      success: true,
      summary: 'ok',
      ...(withUsage ? { sentTokens: 11, receivedTokens: 3 } : {}),
    }).generateSummary('content'),
  },
] as const;

const httpProviders = providers.filter((row) => row.reachesTransport);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('プロバイダーは同じ契約を満たす', () => {
  it.each(providers)('$name: 名前とIDを契約どおり返す', ({ create }) => {
    const provider = create();

    expect(provider.getName()).toBeTypeOf('string');
    // getProviderId defaults to the name, so a provider that never overrides
    // it still has the id its settings bag is keyed by.
    expect(provider.getProviderId()).toBe(provider.getName());
  });

  it.each(providers)('$name: 要約と接続テストを実装している', ({ create }) => {
    const provider = create();

    expect(provider.generateSummary).toBeTypeOf('function');
    expect(provider.testConnection).toBeTypeOf('function');
  });

  // The base publishes what a caller programs against; a provider that reaches
  // a transport must be the one that inherits the request templates. This is
  // the check that keeps a non-HTTP provider from growing a pre-flight budget
  // or a body cap it must never apply.
  it.each(providers)('$name: 要求テンプレートを持つかどうかが到達範囲と一致する', ({ create, reachesTransport }) => {
    const provider = create();
    const surface = provider as unknown as Record<string, unknown>;

    expect(provider instanceof AIProviderStrategy).toBe(true);
    expect(provider instanceof HttpProviderStrategy).toBe(reachesTransport);
    expect(surface['executeHttpSummaryFlow'] !== undefined).toBe(reachesTransport);
    expect(surface['checkPreFlight'] !== undefined).toBe(reachesTransport);
  });
});

describe('リトライ方針は transport の述語 1 つに統一されている', () => {
  it.each(httpProviders)('$name: 自前の述語を持たない', async ({ summarize }) => {
    await summarize(false);

    const retry = mockedFetch.mock.calls[0]![2] as Record<string, unknown>;
    // Regression guard in both directions. A provider that installs its own
    // predicate diverges from the connection test — Gemini once retried a 429
    // and OpenAI did not — and one that names a local copy keeps that copy
    // alive after the transport's own policy changes.
    expect(retry.shouldRetry).toBeUndefined();
  });

  it('オンデバイスは送信しないので、述語を持つ必要がない', async () => {
    const result = await builtInProvider().generateSummary('content');

    expect(result.success).toBe(true);
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});

describe('使用量記録は全プロバイダーで揃っている', () => {
  it.each(providers)('$name: usage が無ければ記録しない', async ({ summarize }) => {
    await summarize(false);

    // Regression: Gemini used to record a bogus (0, 0) row for unknown usage.
    expect(mockRecordUsage).not.toHaveBeenCalled();
  });

  it.each(providers)('$name: usage が取得できたら記録する', async ({ summarize }) => {
    await summarize(true);

    expect(mockRecordUsage).toHaveBeenCalledWith(11, 3);
  });
});

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
