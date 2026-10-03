/**
 * HttpProviderStrategy.test.ts
 * The policies the HTTP flows own: the pre-flight budget gate, the input
 * sanitizer and the test-debug base. They are here rather than on the base
 * class because only a provider that reaches a transport can run them — an
 * on-device provider must not be able to spend a cloud budget.
 */
import { vi, describe, test, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Settings } from '../../../../utils/storage/types.js';
import {
  HttpProviderStrategy,
  type HttpTestContext,
} from '../HttpProviderStrategy.js';
import type { AIProviderConnectionResult, AISummaryResult } from '../ProviderStrategy.js';

const {
  checkHardLimitMock,
  checkUsageWarningMock,
  checkRateLimitMock,
  getRateLimitMessageMock,
  sanitizePromptContentMock,
  addLogMock,
} = vi.hoisted(() => ({
  checkHardLimitMock: vi.fn(async (): Promise<{ blocked: boolean; message?: string }> => ({ blocked: false })),
  checkUsageWarningMock: vi.fn(async (): Promise<{ warning: boolean; message?: string }> => ({ warning: false })),
  checkRateLimitMock: vi.fn(async () => ({ allowed: true, remaining: 9, resetTime: Date.now() + 60000 })),
  getRateLimitMessageMock: vi.fn(() => 'Rate limit exceeded'),
  sanitizePromptContentMock: vi.fn((): { sanitized: string; warnings: string[]; dangerLevel: string } => ({ sanitized: 'safe content', warnings: [], dangerLevel: 'low' })),
  addLogMock: vi.fn(),
}));

vi.mock('../../../../utils/aiUsageTracker.js', () => ({
  checkHardLimit: checkHardLimitMock,
  checkUsageWarning: checkUsageWarningMock,
  checkRateLimit: checkRateLimitMock,
  getRateLimitMessage: getRateLimitMessageMock,
  recordUsage: vi.fn(),
}));

vi.mock('../../../../utils/promptSanitizer.js', () => ({
  sanitizePromptContent: sanitizePromptContentMock,
}));

vi.mock('../../../../utils/logger/types.js', async () =>
  (await import('../../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    addLog: addLogMock,
    LogType: { WARN: 'warn', ERROR: 'error', INFO: 'info', DEBUG: 'debug' },
  }),
);
vi.mock('../../../../utils/logger/core.js', async () =>
  (await import('../../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    addLog: addLogMock,
    LogType: { WARN: 'warn', ERROR: 'error', INFO: 'info', DEBUG: 'debug' },
  }),
);
vi.mock('../../../../utils/logger/api.js', async () =>
  (await import('../../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logDebug: 'fn',
    addLog: addLogMock,
    LogType: { WARN: 'warn', ERROR: 'error', INFO: 'info', DEBUG: 'debug' },
  }),
);

class HttpProbe extends HttpProviderStrategy {
  async generateSummary(): Promise<AISummaryResult> {
    return { success: true, summary: 'probe' };
  }

  async testConnection(): Promise<AIProviderConnectionResult> {
    return { success: true, message: 'probe' };
  }

  getName(): string {
    return 'http-probe';
  }

  callCheckPreFlight() {
    return this.checkPreFlight();
  }

  callSanitizeContent(content: string, providerName: string, traceId: string) {
    return this.sanitizeContent(content, providerName, traceId);
  }

  callBuildTestDebugBase(ctx: HttpTestContext, hasContent: boolean, responseText?: string) {
    return this.buildTestDebugBase(ctx, hasContent, responseText);
  }
}

function probe(): HttpProbe {
  return new HttpProbe({} as Settings);
}

beforeEach(() => {
  vi.clearAllMocks();
  checkHardLimitMock.mockResolvedValue({ blocked: false });
  checkUsageWarningMock.mockResolvedValue({ warning: false });
  checkRateLimitMock.mockResolvedValue({ allowed: true, remaining: 9, resetTime: Date.now() + 60000 });
  getRateLimitMessageMock.mockReturnValue('Rate limit exceeded');
});

describe('checkPreFlight', () => {
  test('returns { blocked: true, message } when blocked by hardLimit', async () => {
    checkHardLimitMock.mockResolvedValue({ blocked: true, message: 'Monthly limit reached' });

    const result = await probe().callCheckPreFlight();

    expect(result).toEqual({ blocked: true, message: 'Error: Monthly limit reached' });
  });

  test('returns { blocked: true, message } on usageWarning', async () => {
    checkUsageWarningMock.mockResolvedValue({ warning: true, message: 'Usage warning' });

    const result = await probe().callCheckPreFlight();

    expect(result).toEqual({ blocked: true, message: 'Error: Usage warning' });
  });

  test('returns { blocked: true, message } when blocked by rateLimit', async () => {
    checkRateLimitMock.mockResolvedValue({ allowed: false, remaining: 0, resetTime: Date.now() + 60000 });

    const result = await probe().callCheckPreFlight();

    expect(result).toEqual({ blocked: true, message: 'Error: Rate limit exceeded' });
  });

  test('returns { blocked: false } when all checks pass', async () => {
    const result = await probe().callCheckPreFlight();

    expect(result).toEqual({ blocked: false });
  });
});

describe('sanitizeContent', () => {
  test('returns { blocked: true } when dangerLevel=high', () => {
    sanitizePromptContentMock.mockReturnValue({
      sanitized: 'sanitized',
      warnings: ['injection detected'],
      dangerLevel: 'high',
    });

    const result = probe().callSanitizeContent('malicious content', 'http-probe', 'trace-1');

    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain('injection detected');
  });

  test('returns { blocked: false, sanitized } when dangerLevel=low', () => {
    sanitizePromptContentMock.mockReturnValue({
      sanitized: 'safe content',
      warnings: [],
      dangerLevel: 'low',
    });

    const result = probe().callSanitizeContent('safe content', 'http-probe', 'trace-1');

    expect(result.blocked).toBe(false);
    expect(result.sanitized).toBe('safe content');
  });

  test('includes category=generic_term in the structured log when dangerLevel=low', () => {
    sanitizePromptContentMock.mockReturnValue({
      sanitized: 'sanitized',
      warnings: ['Detected potential command: "system"'],
      dangerLevel: 'low',
    });

    probe().callSanitizeContent('content with generic term', 'http-probe', 'trace-2');

    expect(addLogMock).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('Prompt injection detected'),
      expect.objectContaining({
        traceId: 'trace-2',
        dangerLevel: 'low',
        category: 'generic_term',
      }),
    );
  });
});

// The promise a new HTTP provider makes is that it needs no edit to the base
// class. That is only true while the base holds no transport code, so the
// absence is pinned here rather than left to a reader's memory.
describe('責務分離の静的ピン', () => {
  const base = readFileSync(new URL('../ProviderStrategy.ts', import.meta.url), 'utf8');

  it.each([
    ['fetchWithRetry', '送信の記述'],
    ['readJsonCapped', '応答の読み取り'],
    ['describeHttpFailure', '失敗の写像'],
    ['shouldRetry', 'リトライ述語'],
    ['checkPreFlight', '送信前ガード'],
    ['executeHttpSummaryFlow', 'テンプレート'],
  ])('基底クラスは %s（%s）を持たない', (needle) => {
    expect(base).not.toContain(needle);
  });

  it('テンプレートは基底、HTTP フローは新しいモジュールに在る', () => {
    const http = readFileSync(new URL('../HttpProviderStrategy.ts', import.meta.url), 'utf8');

    expect(http).toContain('executeHttpSummaryFlow');
    expect(http).toContain('executeHttpTestFlow');
    expect(http).toContain('checkPreFlight');
  });
});

describe('buildTestDebugBase', () => {  const ctx: HttpTestContext = { endpoint: 'POST https://example.com/v1/chat', statusCode: 200, modelName: 'm' };

  test('carries the prompt, endpoint, model and status of the test', () => {
    const debug = probe().callBuildTestDebugBase(ctx, true, 'hello');

    expect(debug).toEqual({
      prompt: 'Reply with the single word: OK',
      endpoint: ctx.endpoint,
      modelName: 'm',
      statusCode: 200,
      hasContent: true,
      response: 'hello',
    });
  });

  test('omits the response text when the body was empty', () => {
    const debug = probe().callBuildTestDebugBase(ctx, false, '   ');

    expect(debug.response).toBeUndefined();
    expect(debug.hasContent).toBe(false);
  });

  test('omits modelName when the provider reported none', () => {
    const debug = probe().callBuildTestDebugBase({ endpoint: ctx.endpoint, statusCode: 200 }, false);

    expect(debug.modelName).toBeUndefined();
  });
});
