/**
 * httpSummaryFlow.test.ts
 * The HTTP summary spine (executeHttpSummaryFlow) is driven once through the
 * interface with faked hooks — providers narrow to parsing/limits afterwards.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

const { fetchWithRetryMock, applyCustomPromptMock, readJsonCappedMock, buildAllowedUrlsMock } = vi.hoisted(() => ({
  fetchWithRetryMock: vi.fn(),
  applyCustomPromptMock: vi.fn(
    (_settings: unknown, _provider: string, content: string) => ({
      userPrompt: `Summarize: ${content}`,
      systemPrompt: 'system',
    }),
  ),
  readJsonCappedMock: vi.fn(),
  buildAllowedUrlsMock: vi.fn((): Set<string> => new Set<string>()),
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
  buildAllowedUrls: buildAllowedUrlsMock,
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
vi.mock('../../../../utils/logger/types.js', () => ({
  addLog: vi.fn(),
  LogType: { WARN: 'warn', ERROR: 'error', INFO: 'info', DEBUG: 'debug' },
}));
vi.mock('../../../../utils/logger/core.js', () => ({
  addLog: vi.fn(),
  LogType: { WARN: 'warn', ERROR: 'error', INFO: 'info', DEBUG: 'debug' },
}));
vi.mock('../../../../utils/logger/api.js', () => ({
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

    // Display parity: the user-facing sentence is unchanged.
    expect(result.summary).toBe('Error: API key is missing.');
    expect(result.success).toBe(false);
    // PBI 2026-09-25-11: a missing key is structured as `configuration`, so
    // the retry decision reads the kind instead of the message.
    expect(result.failure).toEqual({ kind: 'configuration' });
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

    // Display parity: both the summary sentence and the per-slot diagnostic
    // detail are byte-identical to the pre-taxonomy result.
    expect(result.summary).toBe('Error: AI request timed out. Please check your connection.');
    expect(result.error).toBe('timed out');
    expect(result.success).toBe(false);
    // PBI 2026-09-25-11: the AbortError name becomes structured `timeout`
    // metadata, distinguishable from `network` without reading the message.
    expect(result.failure).toEqual({ kind: 'timeout', cause: { name: 'AbortError' } });
  });

  it('classifies a thrown HTTP status without touching the summary wording', async () => {
    const http = new Error('HTTP 429: Too Many Requests');
    http.name = 'HttpStatusError';
    Object.assign(http, { failure: { kind: 'rate_limit', status: 429, method: 'POST' } });
    fetchWithRetryMock.mockRejectedValue(http);
    const probe = new FlowProbe({} as Settings, makeHooks());
    const result = await probe.generateSummary('hello');

    expect(result.summary).toBe('Error: Failed to generate summary. Please try again or check your settings.');
    expect(result.failure).toEqual({ kind: 'rate_limit', status: 429, method: 'POST' });
  });

  it('keeps API key material out of the failure metadata', async () => {
    const leaky = new Error('fetch failed: Authorization Bearer sk-secret-1234 body {"key":"sk-secret-1234"}');
    leaky.name = 'NetworkError';
    fetchWithRetryMock.mockRejectedValue(leaky);
    const probe = new FlowProbe({} as Settings, makeHooks());
    const result = await probe.generateSummary('hello');

    expect(result.failure).toEqual({ kind: 'network', cause: { name: 'NetworkError' } });
    expect(JSON.stringify(result.failure)).not.toContain('sk-secret-1234');
  });
});
