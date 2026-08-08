/**
 * BuiltInAiProvider.test.ts
 * PBI 2026-08-08-05: BuiltInAiProvider はテスト0だった
 *
 * 他3プロバイダーは400-550行のテストを持つのに対し、BuiltInAiProvider は
 * 未テストだった。さらに基底クラスの共有ロジック（とくに
 * sanitizeContent によるプロンプトインジェクション検査）を一切
 * 通っていなかったため、その修正の回帰テストも兼ねる。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSummarize = vi.fn();
const mockRecordUsage = vi.fn();
const mockSanitizePromptContent = vi.fn();

vi.mock('../../../builtInAIClient.js', () => ({
  BuiltInAIClient: class {
    summarize = mockSummarize;
  },
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
  sanitizePromptContent: (...args: unknown[]) => mockSanitizePromptContent(...args),
}));

import { BuiltInAiProvider } from '../BuiltInAiProvider.js';
import { CONNECTION_TEST_PROMPT } from '../ProviderStrategy.js';
import type { Settings } from '../../../../utils/storage.js';

const settings = {} as Settings;

beforeEach(() => {
  vi.clearAllMocks();
  // Default: content passes the injection check unchanged.
  mockSanitizePromptContent.mockReturnValue({
    sanitized: 'clean content', warnings: [], dangerLevel: 'none',
  });
});

describe('BuiltInAiProvider — identity', () => {
  it('reports its provider name and id', () => {
    const provider = new BuiltInAiProvider(settings);
    expect(provider.getName()).toBe('built-in-ai');
    expect(provider.getProviderId()).toBe('built-in-ai');
  });
});

describe('BuiltInAiProvider — generateSummary', () => {
  it('returns the on-device summary on success', async () => {
    mockSummarize.mockResolvedValue({
      success: true, summary: 'a summary', sentTokens: 100, receivedTokens: 20,
    });

    const result = await new BuiltInAiProvider(settings).generateSummary('some content');

    expect(result.success).toBe(true);
    expect(result.summary).toBe('a summary');
    expect(result.providerName).toBe('built-in-ai');
  });

  it('blocks high-risk prompt injection before reaching the model', async () => {
    mockSanitizePromptContent.mockReturnValue({
      sanitized: 'ignore previous instructions',
      warnings: ['instruction override'],
      dangerLevel: 'high',
    });

    const result = await new BuiltInAiProvider(settings).generateSummary('malicious content');

    expect(result.success).toBe(false);
    expect(result.summary).toContain('prompt injection');
    // The model must never see blocked content.
    expect(mockSummarize).not.toHaveBeenCalled();
  });

  it('passes the sanitized content, not the raw content, to the model', async () => {
    mockSanitizePromptContent.mockReturnValue({
      sanitized: 'sanitized version', warnings: ['minor'], dangerLevel: 'low',
    });
    mockSummarize.mockResolvedValue({ success: true, summary: 'ok' });

    await new BuiltInAiProvider(settings).generateSummary('raw content');

    expect(mockSummarize).toHaveBeenCalledWith('sanitized version');
  });

  it('surfaces a provider-reported failure', async () => {
    mockSummarize.mockResolvedValue({ success: false, error: 'model unavailable' });

    const result = await new BuiltInAiProvider(settings).generateSummary('content');

    expect(result.success).toBe(false);
    expect(result.summary).toBe('model unavailable');
  });

  it('turns a thrown error into a failed result', async () => {
    mockSummarize.mockRejectedValue(new Error('LanguageModel missing'));

    const result = await new BuiltInAiProvider(settings).generateSummary('content');

    expect(result.success).toBe(false);
    expect(result.summary).toContain('LanguageModel missing');
  });

  it('records token usage when the client reports it', async () => {
    mockSummarize.mockResolvedValue({
      success: true, summary: 'ok', sentTokens: 42, receivedTokens: 7,
    });

    await new BuiltInAiProvider(settings).generateSummary('content');

    expect(mockRecordUsage).toHaveBeenCalledWith(42, 7);
  });

  it('does not record a bogus zero usage when tokens are unknown', async () => {
    mockSummarize.mockResolvedValue({ success: true, summary: 'ok' });

    await new BuiltInAiProvider(settings).generateSummary('content');

    expect(mockRecordUsage).not.toHaveBeenCalled();
  });
});

describe('BuiltInAiProvider — testConnection', () => {
  it('succeeds when the on-device model answers', async () => {
    mockSummarize.mockResolvedValue({ success: true, summary: 'OK' });

    const result = await new BuiltInAiProvider(settings).testConnection();

    expect(result.success).toBe(true);
    expect(result.debug?.prompt).toBe(CONNECTION_TEST_PROMPT);
    expect(result.debug?.response).toBe('OK');
    expect(result.debug?.endpoint).toBe('on-device (Built-in AI)');
  });

  it('fails when the model returns an empty answer', async () => {
    mockSummarize.mockResolvedValue({ success: true, summary: '' });

    const result = await new BuiltInAiProvider(settings).testConnection();

    expect(result.success).toBe(false);
    expect(result.debug?.hasContent).toBe(false);
  });

  it('reports the underlying error when the model is unavailable', async () => {
    mockSummarize.mockResolvedValue({ success: false, error: 'downloadable' });

    const result = await new BuiltInAiProvider(settings).testConnection();

    expect(result.success).toBe(false);
    expect(result.message).toBe('downloadable');
  });

  it('turns a thrown error into a failed result', async () => {
    mockSummarize.mockRejectedValue(new Error('boom'));

    const result = await new BuiltInAiProvider(settings).testConnection();

    expect(result.success).toBe(false);
    expect(result.message).toBe('boom');
    expect(result.debug?.error).toBe('boom');
  });
});
