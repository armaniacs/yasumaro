/**
 * httpSummaryFlow.test.ts
 * The HTTP summary spine (executeHttpSummaryFlow) is driven once through the
 * interface with faked hooks — providers narrow to parsing/limits afterwards.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

const { fetchWithRetryMock, applyCustomPromptMock, readJsonCappedMock, getAllowedUrlsMock } = vi.hoisted(() => ({
  fetchWithRetryMock: vi.fn(),
  applyCustomPromptMock: vi.fn(
    (_settings: unknown, _provider: string, content: string) => ({
      userPrompt: `Summarize: ${content}`,
      systemPrompt: 'system',
    }),
  ),
  readJsonCappedMock: vi.fn(),
  getAllowedUrlsMock: vi.fn(async () => new Set<string>()),
}));

vi.mock('../../../../utils/fetch.js', () => ({
  fetchWithRetry: fetchWithRetryMock,
  fetchWithTimeout: vi.fn(),
  validateUrlForAIRequests: vi.fn(),
}));
vi.mock('../../../../utils/customPromptUtils.js', () => ({
  applyCustomPrompt: applyCustomPromptMock,
  getDefaultSystemPrompt: vi.fn(() => 'default system'),
}));
vi.mock('../../../../utils/readBodyCapped.js', () => ({
  readJsonCapped: readJsonCappedMock,
}));
vi.mock('../../../../utils/storage/urlWhitelist.js', () => ({
  getAllowedUrls: getAllowedUrlsMock,
}));
vi.mock('../../../../utils/aiUsageTracker.js', () => ({
  checkHardLimit: vi.fn(async () => ({ blocked: false })),
  checkUsageWarning: vi.fn(async () => ({ warning: false })),
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  getRateLimitMessage: vi.fn(() => 'limited'),
  recordUsage: vi.fn(),
}));
vi.mock('../../../../utils/promptSanitizer.js', () => ({
  sanitizePromptContent: vi.fn((c: string) => ({ sanitized: c, warnings: [], dangerLevel: 'none' })),
}));
vi.mock('../../../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: { WARN: 'warn', ERROR: 'error', INFO: 'info', DEBUG: 'debug' },
}));

import {
  AIProviderStrategy,
  type AISummaryResult,
  type AIProviderConnectionResult,
  type HttpSummaryHooks,
} from '../ProviderStrategy.js';
import type { Settings } from '../../../../utils/storage/types.js';

class FlowProbe extends AIProviderStrategy {
  constructor(
    settings: Settings,
    private readonly hooks: HttpSummaryHooks,
  ) {
    super(settings);
  }
  async generateSummary(content: string, tagSummaryMode = false, traceId = ''): Promise<AISummaryResult> {
    return this.executeHttpSummaryFlow(content, tagSummaryMode, traceId, this.hooks);
  }
  async testConnection(): Promise<AIProviderConnectionResult> {
    return { success: true, message: 'ok' };
  }
  getName(): string {
    return 'flow-probe';
  }
}

function makeHooks(overrides: Partial<HttpSummaryHooks> = {}): HttpSummaryHooks {
  return {
    providerName: 'flow-probe',
    timeoutMs: 30000,
    checkCredentials: () => null,
    contentLimit: () => 100,
    prepareRequest: async (userPrompt) => ({
      url: 'https://example.com/summarize',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: userPrompt }),
    }),
    handleErrorResponse: async () => ({ success: false, summary: 'hook error' }),
    extractSummary: async (data) => ({ success: true, summary: `parsed:${JSON.stringify(data)}` }),
    ...overrides,
  };
}

function okResponse(body: unknown = {}): Response {
  return { ok: true, json: async () => body } as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchWithRetryMock.mockResolvedValue(okResponse());
  readJsonCappedMock.mockResolvedValue({ text: 'hi' });
});

describe('executeHttpSummaryFlow', () => {
  it('runs the full spine in order with one fetch', async () => {
    const probe = new FlowProbe({} as Settings, makeHooks());
    const result = await probe.generateSummary('hello world');

    expect(result).toEqual({ success: true, summary: 'parsed:{"text":"hi"}' });
    expect(fetchWithRetryMock).toHaveBeenCalledTimes(1);
    const [url, init, retry] = fetchWithRetryMock.mock.calls[0] as unknown as [
      string,
      { timeoutMs: number },
      { maxRetryCount: number },
    ];
    expect(url).toBe('https://example.com/summarize');
    expect(init.timeoutMs).toBe(30000);
    expect(retry.maxRetryCount).toBe(3);
  });

  it('credential failure short-circuits before any fetch', async () => {
    const probe = new FlowProbe(
      {} as Settings,
      makeHooks({ checkCredentials: () => 'Error: API key is missing.' }),
    );
    const result = await probe.generateSummary('hello');

    expect(result).toEqual({ success: false, summary: 'Error: API key is missing.' });
    expect(fetchWithRetryMock).not.toHaveBeenCalled();
  });

  it('prepareRequest failure returns the hook failure without fetching', async () => {
    const probe = new FlowProbe(
      {} as Settings,
      makeHooks({
        prepareRequest: async () => ({ failure: { success: false, summary: 'Error: bad model.' } }),
      }),
    );
    const result = await probe.generateSummary('hello');

    expect(result).toEqual({ success: false, summary: 'Error: bad model.' });
    expect(fetchWithRetryMock).not.toHaveBeenCalled();
  });

  it('non-ok response delegates to handleErrorResponse', async () => {
    fetchWithRetryMock.mockResolvedValue({ ok: false, status: 404 } as Response);
    const probe = new FlowProbe({} as Settings, makeHooks());
    const result = await probe.generateSummary('hello');

    expect(result).toEqual({ success: false, summary: 'hook error' });
  });

  it('timeout maps to the shared timeout message', async () => {
    const abort = new Error('timed out');
    abort.name = 'AbortError';
    fetchWithRetryMock.mockRejectedValue(abort);
    const probe = new FlowProbe({} as Settings, makeHooks());
    const result = await probe.generateSummary('hello');

    expect(result).toEqual({
      success: false,
      summary: 'Error: AI request timed out. Please check your connection.',
    });
  });
});
