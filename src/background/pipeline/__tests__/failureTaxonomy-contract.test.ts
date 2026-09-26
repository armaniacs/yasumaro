/**
 * failureTaxonomy-contract.test.ts
 *
 * Contract test for PBI 2026-09-25-11: errors and result summaries produced by
 * the REAL Obsidian client and the REAL AI provider chain must reach
 * RetryPolicy as a structured kind, and the retry decision must follow that
 * kind rather than the sanitized message.
 *
 * Deliberately not a unit test of either boundary — the point is the seam
 * between them. Boundary-specific conversion is pinned by
 * `src/background/__tests__/obsidianClient-failureTaxonomy.test.ts` and
 * `src/background/ai/providers/__tests__/httpSummaryFlow.test.ts`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../utils/logger/core.js', () => ({
  addLog: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
  logDebug: vi.fn(),
  logWarn: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
  ErrorCode: { INTERNAL_ERROR: 'INT_001', UNKNOWN_ERROR: 'UNKN_001' },
}));
vi.mock('../../../utils/logger/api.js', () => ({
  addLog: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
  logDebug: vi.fn(),
  logWarn: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
  ErrorCode: { INTERNAL_ERROR: 'INT_001', UNKNOWN_ERROR: 'UNKN_001' },
}));
vi.mock('../../../utils/auditLog.js', () => ({ recordAuditLog: vi.fn() }));

// The Obsidian config is fixed so the storage cascade stays out of the seam
// test; every transformation below fetchWithTimeout stays the real one.
vi.mock('../../../utils/obsidianConfigBuilder.js', () => ({
  buildObsidianConfig: vi.fn(async () => ({
    baseUrl: 'https://127.0.0.1:27124',
    headers: { Authorization: 'Bearer test-key' },
    settings: { OBSIDIAN_DAILY_PATH: '' },
  })),
}));

// The provider seam runs the real transport, so the allowlist and the CSP gate
// have to admit the fixture endpoint. Neither has anything to do with failure
// classification, so both are stubbed at the storage edge instead.
vi.mock('../../../utils/storage/SettingsRepository.js', () => ({
  settingsRepository: {
    getAll: vi.fn(async () => ({ conditional_csp_enabled: false })),
    get: vi.fn(async () => undefined),
    getMany: vi.fn(async () => ({})),
    clearCache: vi.fn(),
    set: vi.fn(),
    setAll: vi.fn(),
  },
  SettingsRepository: class {
    getAll = vi.fn(async () => ({ conditional_csp_enabled: false }));
    get = vi.fn(async () => undefined);
    getMany = vi.fn(async () => ({}));
    clearCache = vi.fn();
    set = vi.fn();
    setAll = vi.fn();
  },
}));
vi.mock('../../../utils/storage/urlWhitelist.js', () => ({
  buildAllowedUrls: vi.fn(() => new Set<string>(['https://example.com/summarize'])),
}));

import { ObsidianClient } from '../../obsidianClient.js';
import { defaultRetryPolicy } from '../retryPolicy.js';
import { StepExecutor } from '../stepExecutor.js';
import { ErrorStrategy, type PipelineStep, type RecordingContext, type StepDeps } from '../types.js';
import type { OfflineNetworkQueue } from '../../offlineNetworkQueue.js';
import { resolveFailure } from '../../../utils/failureTaxonomy.js';
import { useTimerClock } from '../../../../testDir/waitPolicy.js';
import { PrivacyPipeline } from '../../privacyPipeline.js';
import { RemoteAIService } from '../../ai/RemoteAIService.js';
import { AIProviderStrategy, type AISummaryResult, type HttpSummaryHooks } from '../../ai/providers/ProviderStrategy.js';
import type { Settings } from '../../../utils/storage/types.js';
import type { SettingsReader } from '../../../utils/storage/SettingsRepository.js';
import type { AIService, AISummaryOptions } from '../../ai/AIService.js';

function bodyOf(text: string) {
  let sent = false;
  return {
    getReader: () => ({
      read: (): Promise<{ done: boolean; value?: Uint8Array }> => {
        if (sent) return Promise.resolve({ done: true });
        sent = true;
        return Promise.resolve({ done: false, value: new TextEncoder().encode(text) });
      },
      cancel: async () => {},
    }),
  };
}

function cannedResponse(status: number, body = 'boom'): Response {
  return { ok: false, status, body: bodyOf(body), headers: { get: () => null } } as unknown as Response;
}

let client: ObsidianClient;

beforeEach(() => {
  vi.clearAllMocks();
  client = new ObsidianClient();
  global.fetch = vi.fn();
});

// The body-read timeout test drives a fake clock; a leaked one would starve the
// real backoff sleeps inside fetchWithRetry for the tests that follow.
afterEach(() => {
  vi.useRealTimers();
});

/** Drive the production GET→PUT chain and return the error it threw. */
async function obsidianWriteFailure(status: number, body = 'boom'): Promise<Error> {
  const fetch = vi.mocked(global.fetch) as unknown as ReturnType<typeof vi.fn>;
  fetch.mockImplementation((_url: string, init: { method?: string }) =>
    Promise.resolve(init?.method === 'GET' ? cannedResponse(404, '') : cannedResponse(status, body)),
  );
  return (await client.appendToDailyNote('content').catch((e: unknown) => e)) as Error;
}

describe('Obsidian boundary → RetryPolicy', () => {
  it.each([
    [401, 'auth', false],
    [403, 'auth', false],
    [429, 'rate_limit', false],
    [500, 'http', false],
    [503, 'http', false],
  ])('a PUT returning %i reaches the policy as %s (offline eligible: %s)', async (status, kind, eligible) => {
    const error = await obsidianWriteFailure(status);

    expect(resolveFailure(error)?.kind).toBe(kind);
    expect(defaultRetryPolicy.shouldEnqueueForOffline(error)).toBe(eligible);
  });

  it('a transport failure reaches the policy as network and stays offline eligible', async () => {
    const fetch = vi.mocked(global.fetch) as unknown as ReturnType<typeof vi.fn>;
    fetch.mockImplementation((_url: string, init: { method?: string }) =>
      init?.method === 'GET' ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve({ ok: true } as Response),
    );

    const error = (await client.appendToDailyNote('content').catch((e: unknown) => e)) as Error;

    expect(resolveFailure(error)?.kind).toBe('network');
    expect(defaultRetryPolicy.shouldEnqueueForOffline(error)).toBe(true);
  });

  it('a body-read timeout reaches the policy as timeout and stays offline eligible', async () => {
    useTimerClock();
    const fetch = vi.mocked(global.fetch) as unknown as ReturnType<typeof vi.fn>;
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: { getReader: () => ({ read: () => new Promise<never>(() => {}), cancel: async () => {} }) },
      headers: { get: () => null },
    } as unknown as Response);

    const pending = client.appendToDailyNote('content').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(15001);
    const error = (await pending) as Error;

    expect(resolveFailure(error)?.kind).toBe('timeout');
    expect(defaultRetryPolicy.shouldEnqueueForOffline(error)).toBe(true);
  });

  it('an invalid Obsidian port never enters offline recovery', async () => {
    const error = (() => {
      try {
        client._validatePort('not-a-port');
        return new Error('unreachable');
      } catch (e) {
        return e as Error;
      }
    })();

    expect(resolveFailure(error)?.kind).toBe('configuration');
    expect(defaultRetryPolicy.shouldEnqueueForOffline(error)).toBe(false);
  });
});

// ─── AI boundary ──────────────────────────────────────────────────────────

/** A provider probe that runs the real HTTP summary template. */
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
  async testConnection() {
    return { success: true, message: 'ok' };
  }
  getName(): string {
    return 'flow-probe';
  }
}

function makeHooks(): HttpSummaryHooks {
  return {
    providerName: 'flow-probe',
    timeoutMs: 30000,
    checkCredentials: () => null,
    contentLimit: () => 100,
    prepareRequest: async () => ({
      url: 'https://example.com/summarize',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }),
    handleErrorResponse: async () => ({ success: false, summary: 'hook error' }),
    extractSummary: async () => ({ success: true, summary: 'ok' }),
  };
}

/** Real RemoteAIService chain whose single slot runs the real summary template. */
function makeService(provider: AIProviderStrategy): RemoteAIService {
  const repo = {
    getAll: vi.fn(async () => ({
      ai_provider_priority_list: [{ provider: 'probe' }],
      ai_provider: 'probe',
      summary_min_length: 0,
    })),
    getMany: vi.fn(),
  } as unknown as SettingsReader;
  const service = new RemoteAIService({ repo });
  service.registerProvider('probe', () => provider);
  return service;
}

describe('AI boundary → RetryPolicy', () => {
  it('an all-provider timeout failure stays a result whose kind is timeout', async () => {
    const abort = new Error('The operation was aborted');
    abort.name = 'AbortError';
    global.fetch = vi.fn(async () => {
      throw abort;
    }) as unknown as typeof global.fetch;

    const result = await new FlowProbe({} as Settings, makeHooks()).generateSummary('hello');

    // The result contract is unchanged: a failure, not a throw.
    expect(result.success).toBe(false);
    expect(result.summary).toBe('Error: AI request timed out. Please check your connection.');
    expect(resolveFailure(result)?.kind).toBe('timeout');
    // The same normalization judges the result carrier.
    expect(defaultRetryPolicy.shouldEnqueueForOffline(result)).toBe(true);
  });

  it('an HTTP 429 from the provider closes onto rate_limit and never enters offline recovery', async () => {
    global.fetch = vi.fn(async () => {
      const e = new Error('HTTP 429: Too Many Requests');
      Object.assign(e, { failure: { kind: 'rate_limit', status: 429, method: 'POST' } });
      throw e;
    }) as unknown as typeof global.fetch;

    const result = await new FlowProbe({} as Settings, makeHooks()).generateSummary('hello');

    expect(result.failure).toEqual({ kind: 'rate_limit', status: 429, method: 'POST' });
    expect(defaultRetryPolicy.shouldEnqueueForOffline(result)).toBe(false);
  });

  it('an unclassified provider failure produces no kind, so no invented retry eligibility', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('mystery failure');
    }) as unknown as typeof global.fetch;

    const result = await new FlowProbe({} as Settings, makeHooks()).generateSummary('hello');

    expect(result.success).toBe(false);
    expect(result.failure).toBeUndefined();
    expect(defaultRetryPolicy.shouldEnqueueForOffline(result)).toBe(false);
  });

  it('RemoteAIService keeps the first slot failure kind on the aggregate result', async () => {
    const provider = new FlowProbe({} as Settings, makeHooks());
    global.fetch = vi.fn(async () => {
      const e = new Error('HTTP 503: Service Unavailable');
      Object.assign(e, { failure: { kind: 'http', status: 503, method: 'POST' } });
      throw e;
    }) as unknown as typeof global.fetch;

    const service = makeService(provider);
    const aggregate = await service.generateSummary('hello');

    expect(aggregate.success).toBe(false);
    expect(aggregate.attemptedProviders).toEqual(['probe']);
    expect(aggregate.failure).toEqual({ kind: 'http', status: 503, method: 'POST' });
    // `http` is not an offline-recovery kind in this PBI (method-specific
    // delayed recovery is PBI 2026-09-25-12's decision).
    expect(defaultRetryPolicy.shouldEnqueueForOffline(aggregate)).toBe(false);
  });
});

describe('privacyPipeline boundary', () => {
  const settings = { PRIVACY_MODE: 'masked_cloud', PII_SANITIZE_LOGS: false } as unknown as Settings;

  function makePrivacyPipeline(aiResult: AISummaryResult): PrivacyPipeline {
    const aiService = {
      getSupportedModes: () => ['masked_cloud'],
      generateSummary: (async () => aiResult) as unknown as AIService['generateSummary'],
    } as unknown as AIService;
    return new PrivacyPipeline(settings, aiService, {
      sanitizeRegex: async (text: string) => ({ text, maskedItems: [] }),
    });
  }

  it('forwards the failure kind without letting the summary text into the metadata', async () => {
    const summary = 'Error: Failed to generate summary. Please try again or check your settings.';
    const pipeline = makePrivacyPipeline({
      success: false,
      summary,
      error: 'HTTP 401: Unauthorized (key sk-live-SECRET-777)',
      failure: { kind: 'auth', status: 401, method: 'POST' },
      attemptedProviders: ['probe'],
    });

    const result = await pipeline.process('some page content', { url: 'https://example.com' });

    expect(result.aiSucceeded).toBe(false);
    expect(result.failure).toEqual({ kind: 'auth', status: 401, method: 'POST' });
    const serialized = JSON.stringify(result.failure);
    expect(serialized).not.toContain('sk-live-SECRET-777');
    expect(serialized).not.toContain('Failed to generate summary');
  });

  it('a successful summary carries no failure', async () => {
    const pipeline = makePrivacyPipeline({ success: true, summary: 'a real summary' });
    const result = await pipeline.process('some page content', { url: 'https://example.com' });

    expect(result.failure).toBeUndefined();
  });
});

// ─── StepExecutor: both carriers, one normalization ───────────────────────

describe('StepExecutor carrier parity', () => {
  function makeContext(): RecordingContext {
    return {
      data: { url: 'https://example.com', title: 'Example', content: '' },
      traceId: 'trace-1',
      settings: {} as never,
      force: false,
      errors: [],
    } as RecordingContext;
  }

  function makeStep(name: string, error: unknown): PipelineStep {
    return {
      name,
      errorStrategy: ErrorStrategy.FATAL,
      offlineRetry: { jobKind: 'obsidian_sync' },
      execute: vi.fn().mockRejectedValue(error),
    } as unknown as PipelineStep;
  }

  function run(error: unknown): Promise<{ enqueued: boolean }> {
    const queue = { enqueue: vi.fn().mockResolvedValue(true) };
    const executor = new StepExecutor(queue as unknown as OfflineNetworkQueue);
    const step = makeStep('saveObsidian', error);
    return executor
      .executeWithStrategy(step, makeContext(), undefined as unknown as StepDeps)
      .then(() => ({ enqueued: false }))
      .catch(() => ({ enqueued: queue.enqueue.mock.calls.length > 0 }));
  }

  it.each([
    ['network', true],
    ['timeout', true],
    ['auth', false],
    ['rate_limit', false],
    ['configuration', false],
    ['csp', false],
    ['http', false],
  ])('a thrown %s failure is judged by kind, not message', async (kind, enqueued) => {
    const error = new Error('Error: Failed to connect to Obsidian. Please check your settings and connection.');
    Object.assign(error, { failure: { kind } });

    expect(await run(error)).toEqual({ enqueued });
  });

  it('a result-summary carrier with the same kind reaches the same verdict', async () => {
    // The executor's normalization reads a result summary exactly like a thrown
    // error, so downstream PBI 12/15 can rely on one function.
    const summaryCarrier = {
      success: false,
      summary: 'Error: Failed to generate summary. Please try again or check your settings.',
      failure: { kind: 'timeout' },
    };
    expect(defaultRetryPolicy.shouldEnqueueForOffline(summaryCarrier)).toBe(true);

    const authCarrier = {
      success: false,
      summary: 'Error: Failed to generate summary. Please try again or check your settings.',
      failure: { kind: 'rate_limit' },
    };
    expect(defaultRetryPolicy.shouldEnqueueForOffline(authCarrier)).toBe(false);
  });
});
