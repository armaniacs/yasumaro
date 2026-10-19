/**
 * httpHooksUnified.test.ts
 * PBI 2026-10-16-05: HTTPプロバイダHookの1組化。
 *
 * 1組の hooks オブジェクトで要約・接続テストの両フローが動き、
 * 資格文面の変更が1箇所で両フローに反映されることを保証する。
 * BuiltIn（オンデバイス）はHTTP hooksを持たないこともピンする。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fetchWithRetryMock, readJsonCappedMock } = vi.hoisted(() => ({
  fetchWithRetryMock: vi.fn(),
  readJsonCappedMock: vi.fn(),
}));

vi.mock('../../../../utils/fetch.js', () => ({
  NO_REDIRECT_FETCH_POLICY: { redirect: 'error' },
  // PBI 2026-10-19-05: outbound paths take the policy through this seam.
  noRedirectInit: (options: Record<string, unknown> = {}) => ({ redirect: 'error', ...options }),
  fetchWithRetry: fetchWithRetryMock,
  fetchWithTimeout: vi.fn(),
  validateUrlForAIRequests: vi.fn(),
}));
vi.mock('../../../../utils/customPromptUtils.js', () => ({
  applyCustomPrompt: vi.fn((_settings: unknown, _provider: string, content: string) => ({
    userPrompt: `Summarize: ${content}`,
    systemPrompt: 'system',
  })),
  getDefaultSystemPrompt: vi.fn(() => 'default system'),
}));
vi.mock('../../../../utils/readBodyCapped.js', () => ({
  readJsonCapped: readJsonCappedMock,
}));
vi.mock('../../../../utils/storage/urlWhitelist.js', () => ({
  buildAllowedUrls: vi.fn((): Set<string> => new Set<string>()),
}));
vi.mock('../../../../utils/aiUsageTracker.js', () => ({
  checkHardLimit: vi.fn(async () => ({ blocked: false })),
  checkUsageWarning: vi.fn(async () => ({ warning: false })),
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  getRateLimitMessage: vi.fn(() => 'limited'),
  recordUsage: vi.fn(),
}));
vi.mock('../../../../utils/logger/types.js', async () =>
  (await import('../../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    addLog: 'fn',
    LogType: { WARN: 'warn', ERROR: 'error', INFO: 'info', DEBUG: 'debug' },
  }),
);
vi.mock('../../../../utils/logger/core.js', async () =>
  (await import('../../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    addLog: 'fn',
    LogType: { WARN: 'warn', ERROR: 'error', INFO: 'info', DEBUG: 'debug' },
  }),
);
vi.mock('../../../../utils/logger/api.js', async () =>
  (await import('../../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    addLog: 'fn',
    LogType: { WARN: 'warn', ERROR: 'error', INFO: 'info', DEBUG: 'debug' },
  }),
);

import {
  HttpProviderStrategy,
  type HttpProviderHooks,
} from '../HttpProviderStrategy.js';
import type { AISummaryResult, AIProviderConnectionResult } from '../ProviderStrategy.js';
import type { Settings } from '../../../../utils/storage/types.js';

/** 単一の hooks で両フローを駆動する probe */
class UnifiedProbe extends HttpProviderStrategy {
  constructor(
    settings: Settings,
    private readonly hooks: HttpProviderHooks,
  ) {
    super(settings);
  }
  async generateSummary(content: string, tagSummaryMode = false, traceId = ''): Promise<AISummaryResult> {
    return this.executeHttpSummaryFlow(content, tagSummaryMode, traceId, this.hooks);
  }
  async testConnection(): Promise<AIProviderConnectionResult> {
    return this.executeHttpTestFlow(this.hooks);
  }
  getName(): string {
    return 'unified-probe';
  }
}

function makeUnifiedHooks(overrides: Partial<HttpProviderHooks> = {}): HttpProviderHooks {
  return {
    providerName: 'unified-probe',
    providerLabel: 'UnifiedProbe',
    timeoutMs: 30000,
    checkCredentials: () => null,
    contentLimit: () => 100,
    prepareRequest: async (userPrompt) => ({
      url: 'https://example.com/summarize',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: userPrompt }),
    }),
    buildRequest: async () => ({
      url: 'https://example.com/test',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ping: true }),
      modelName: 'probe-model',
    }),
    extractSummary: async (data) => ({ success: true, summary: `parsed:${JSON.stringify(data)}` }),
    extractResponse: (data, ctx) => ({
      success: true,
      message: 'Connected.',
      debug: {
        prompt: 'Reply with the single word: OK',
        endpoint: ctx.endpoint,
        statusCode: ctx.statusCode,
        hasContent: true,
        response: JSON.stringify(data),
      },
    }),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchWithRetryMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);
  readJsonCappedMock.mockResolvedValue({ text: 'hi' });
});

describe('HttpProviderHooks 統一', () => {
  it('1組のhooksで要約と接続テストの両方が動く', async () => {
    const probe = new UnifiedProbe({} as Settings, makeUnifiedHooks());

    const summary = await probe.generateSummary('hello world');
    const test = await probe.testConnection();

    expect(summary).toEqual({ success: true, summary: 'parsed:{"text":"hi"}' });
    expect(test.success).toBe(true);
    expect(test.debug?.endpoint).toBe('POST https://example.com/test');
    // 両フローでfetchが各1回
    expect(fetchWithRetryMock).toHaveBeenCalledTimes(2);
  });

  it('資格文面の変更1箇所が要約・テスト両方に反映される', async () => {
    const probe = new UnifiedProbe(
      {} as Settings,
      makeUnifiedHooks({
        checkCredentials: () => ({
          summaryMessage: 'Error: API key is missing. Please check your settings.',
          testMessage: 'UnifiedProbe API Key is not set.',
          testError: 'API key is missing',
        }),
      }),
    );

    const summary = await probe.generateSummary('hello');
    const test = await probe.testConnection();

    expect(summary).toEqual({
      success: false,
      summary: 'Error: API key is missing. Please check your settings.',
      failure: { kind: 'configuration' },
    });
    expect(test).toEqual({
      success: false,
      message: 'UnifiedProbe API Key is not set.',
      debug: { error: 'API key is missing', failure: { kind: 'configuration' } },
    });
    expect(fetchWithRetryMock).not.toHaveBeenCalled();
  });

  it('旧2組インターフェースはソースから消える', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../HttpProviderStrategy.ts', import.meta.url), 'utf8');
    expect(src).toContain('interface HttpProviderHooks');
    expect(src).not.toContain('interface HttpSummaryHooks');
    expect(src).not.toContain('interface HttpTestHooks');
  });

  it('BuiltInはHTTP hooksを持たない（オンデバイス契約）', async () => {
    const { BuiltInAiProvider } = await import('../BuiltInAiProvider.js');
    const { HttpProviderStrategy: Base } = await import('../HttpProviderStrategy.js');
    const provider = new BuiltInAiProvider({} as Settings, {
      summarize: async () => ({ success: true, summary: 'ok' }),
    });

    expect(provider instanceof Base).toBe(false);
    expect('executeHttpSummaryFlow' in provider).toBe(false);
    expect('executeHttpTestFlow' in provider).toBe(false);
  });
});
