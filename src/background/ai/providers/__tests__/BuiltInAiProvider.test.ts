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

vi.mock('../../../../utils/logger/types.js', () => ({
  addLog: vi.fn(),
  LogType: { ERROR: 'error', WARN: 'warn', INFO: 'info', DEBUG: 'debug' },
}));
vi.mock('../../../../utils/logger/core.js', () => ({
  addLog: vi.fn(),
  LogType: { ERROR: 'error', WARN: 'warn', INFO: 'info', DEBUG: 'debug' },
}));
vi.mock('../../../../utils/logger/api.js', () => ({
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

const mockApplyCustomPrompt = vi.fn();

vi.mock('../../../../utils/customPromptUtils.js', () => ({
  applyCustomPrompt: (...args: unknown[]) => mockApplyCustomPrompt(...args),
}));

import { BuiltInAiProvider } from '../BuiltInAiProvider.js';
import { CONNECTION_TEST_PROMPT } from '../ProviderStrategy.js';
import { FailureKind, createFailure, tagFailure } from '../../../../utils/failureTaxonomy.js';
import type { Settings } from '../../../../utils/storage/types.js';

const settings = {} as Settings;

beforeEach(() => {
  vi.clearAllMocks();
  // Default: content passes the injection check unchanged.
  mockSanitizePromptContent.mockReturnValue({
    sanitized: 'clean content', warnings: [], dangerLevel: 'none',
  });
  // Default: no custom prompt is active.
  mockApplyCustomPrompt.mockReturnValue({
    userPrompt: 'default prompt with content', systemPrompt: 'default system', isCustom: false,
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

  it('delegates the prompt-injection check to the client (single sanitize at the model boundary)', async () => {
    // BuiltInAIClient.summarize owns the on-device check (checkPromptSafety
    // with the 'builtin-input' profile). The provider passes raw content — a
    // second, provider-side pass would apply the HTTP 'provider-input'
    // profile and duplicate the verdict with a divergent label.
    mockSummarize.mockResolvedValue({ success: true, summary: 'ok' });

    await new BuiltInAiProvider(settings).generateSummary('raw content');

    expect(mockSummarize).toHaveBeenCalledWith('raw content');
    expect(mockApplyCustomPrompt).toHaveBeenCalledWith(
      settings, 'built-in-ai', 'raw content', false,
    );
  });

  it('maps a client-reported block to a failed result', async () => {
    mockSummarize.mockResolvedValue({
      success: false, error: 'Content contains potentially dangerous patterns',
    });

    const result = await new BuiltInAiProvider(settings).generateSummary('malicious content');

    expect(result.success).toBe(false);
    expect(result.summary).toBe('Content contains potentially dangerous patterns');
    // A state the user resolves (other content / other model), so the breaker
    // must not cool the slot down for it.
    expect(result.failure).toEqual({ kind: FailureKind.CONFIGURATION });
  });

  it('applies an active custom prompt as the prompt override', async () => {
    mockApplyCustomPrompt.mockReturnValue({
      userPrompt: 'custom user prompt (content embedded)', systemPrompt: 'custom system', isCustom: true,
    });
    mockSummarize.mockResolvedValue({ success: true, summary: 'ok' });

    const result = await new BuiltInAiProvider(settings).generateSummary('content', false);

    // applyCustomPrompt receives the provider id and the raw content
    expect(mockApplyCustomPrompt).toHaveBeenCalledWith(
      settings, 'built-in-ai', 'content', false,
    );
    expect(mockSummarize).toHaveBeenCalledWith('content', {
      promptOverride: 'custom user prompt (content embedded)',
      systemPromptOverride: 'custom system',
    });
    expect(result.success).toBe(true);
  });

  it('keeps the legacy single-content call when no custom prompt is active', async () => {
    mockSummarize.mockResolvedValue({ success: true, summary: 'ok' });

    await new BuiltInAiProvider(settings).generateSummary('content');

    // No extra options argument in the default path
    expect(mockSummarize.mock.calls[0]).toHaveLength(1);
  });

  it('surfaces a provider-reported failure', async () => {
    mockSummarize.mockResolvedValue({ success: false, error: 'model unavailable' });

    const result = await new BuiltInAiProvider(settings).generateSummary('content');

    expect(result.success).toBe(false);
    expect(result.summary).toBe('model unavailable');
    expect(result.failure).toEqual({ kind: FailureKind.CONFIGURATION });
  });

  it('keeps the exception text out of the summary and carries the kind', async () => {
    mockSummarize.mockRejectedValue(new Error('LanguageModel missing'));

    const result = await new BuiltInAiProvider(settings).generateSummary('content');

    // The summary is the page summary the recording path persists, so it holds
    // the fixed sentence only; the detail travels on `error`.
    expect(result.success).toBe(false);
    expect(result.summary).toBe('Error: Failed to generate summary. Please try again or check your settings.');
    expect(result.summary).not.toContain('LanguageModel missing');
    expect(result.error).toBe('LanguageModel missing');
    expect(result.failure).toEqual({ kind: FailureKind.CONFIGURATION });
  });

  it('prefers a structured kind carried by the thrown error', async () => {
    mockSummarize.mockRejectedValue(
      tagFailure(new Error('aborted'), createFailure(FailureKind.TIMEOUT, { cause: new Error('aborted') })),
    );

    const result = await new BuiltInAiProvider(settings).generateSummary('content');

    expect(result.failure?.kind).toBe(FailureKind.TIMEOUT);
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
    expect(result.debug?.failure).toEqual({ kind: FailureKind.CONFIGURATION });
  });

  it('reports the underlying error when the model is unavailable', async () => {
    mockSummarize.mockResolvedValue({ success: false, error: 'downloadable' });

    const result = await new BuiltInAiProvider(settings).testConnection();

    expect(result.success).toBe(false);
    expect(result.message).toBe('downloadable');
    expect(result.debug?.failure).toEqual({ kind: FailureKind.CONFIGURATION });
  });

  it('turns a thrown error into a failed result', async () => {
    mockSummarize.mockRejectedValue(new Error('boom'));

    const result = await new BuiltInAiProvider(settings).testConnection();

    // The test-panel message keeps the raw detail; only the summary path is a
    // persistence surface, and there the detail is already split off.
    expect(result.success).toBe(false);
    expect(result.message).toBe('boom');
    expect(result.debug?.error).toBe('boom');
    expect(result.debug?.failure).toEqual({ kind: FailureKind.CONFIGURATION });
  });
});
