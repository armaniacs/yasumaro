import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrivacyPipeline, DEGENERATE_SUMMARY_FALLBACK } from '../privacyPipeline.js';
import { StorageKeys } from '../../utils/storage/types.js';
import { addLog } from '../../utils/logger.js';

vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: { WARN: 'warn', ERROR: 'error', INFO: 'info', DEBUG: 'debug', SANITIZE: 'sanitize' },
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock('../../utils/pendingStorage.js', () => ({
  addPendingPage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../utils/promptSanitizer.js', () => ({
  // Pass the summary through unchanged so the guard sees the real LLM text.
  sanitizePromptContent: vi.fn((text: string) => ({
    sanitized: text,
    warnings: [],
    dangerLevel: 'low',
  })),
  DangerLevel: { LOW: 'low', MEDIUM: 'medium', HIGH: 'high' },
}));

const mockSanitizers = {
  sanitizeRegex: vi.fn().mockResolvedValue({ text: 'masked content', maskedItems: [] }),
};

function makeAi(summary: string) {
  return {
    getSupportedModes: vi.fn().mockReturnValue(['full_pipeline']),
    generateSummary: vi.fn().mockResolvedValue({ summary, providerName: 'openai-compatible' }),
  };
}

describe('LLM output guard — privacyPipeline integration', () => {
  const settings = {
    [StorageKeys.PRIVACY_MODE]: 'masked_cloud',
    [StorageKeys.PII_SANITIZE_LOGS]: false,
  };

  beforeEach(() => {
    vi.mocked(addLog).mockClear();
  });

  it('replaces a degenerate cloud summary with the Japanese fallback', async () => {
    const degenerate = Array.from({ length: 200 }, () => '豚肉').join(' | ');
    // @ts-expect-error partial AIService mock
    const pipeline = new PrivacyPipeline(settings, makeAi(degenerate), mockSanitizers);

    const result = await pipeline.process('content', {});

    expect(result.summary).toBe(DEGENERATE_SUMMARY_FALLBACK);
  });

  it('logs a WARN with reason, repetitionRate and providerName on fallback', async () => {
    const degenerate = Array.from({ length: 200 }, () => '豚肉').join(' | ');
    // @ts-expect-error partial AIService mock
    const pipeline = new PrivacyPipeline(settings, makeAi(degenerate), mockSanitizers);

    await pipeline.process('content', {});

    const warn = vi.mocked(addLog).mock.calls.find(
      (c) => c[1] === 'Degenerate LLM output detected',
    );
    expect(warn).toBeDefined();
    const ctx = warn?.[2] as { reason?: string; repetitionRate?: number; providerName?: string };
    expect(ctx.reason).toBe('repetition');
    expect(ctx.repetitionRate).toBeGreaterThan(0.3);
    expect(ctx.providerName).toBe('openai-compatible');
  });

  it('lets a natural summary through untouched', async () => {
    const natural =
      '大戸屋の期間限定メニューは豚肉の生姜焼きが中心となっている。ご飯が進む甘辛い味付けで、多くの利用者から好評を得ている。数量限定のため早めの来店が推奨されている。';
    // @ts-expect-error partial AIService mock
    const pipeline = new PrivacyPipeline(settings, makeAi(natural), mockSanitizers);

    const result = await pipeline.process('content', {});

    expect(result.summary).toContain('大戸屋');
    expect(result.summary).not.toBe(DEGENERATE_SUMMARY_FALLBACK);
  });

  it('does not flag a legit 5-tag tagSummaryMode output (guard runs on body only)', async () => {
    const tagged =
      '#フード・レシピ #ライフスタイル・雑記 #エンタメ・ゲーム #ビジネス・経済 #トラベル・アウトドア | 大戸屋の期間限定メニューを紹介する記事です。豚肉料理が中心となっています。';
    // @ts-expect-error partial AIService mock
    const pipeline = new PrivacyPipeline(settings, makeAi(tagged), mockSanitizers);

    const result = await pipeline.process('content', { tagSummaryMode: true });

    expect(result.summary).not.toBe(DEGENERATE_SUMMARY_FALLBACK);
    expect(result.summary).toContain('大戸屋');
    expect(result.tags).toEqual(
      expect.arrayContaining(['フード・レシピ', 'エンタメ・ゲーム']),
    );
  });
});

describe('LLM output guard — BrowsingLogRecord is not polluted', () => {
  const settings = {
    [StorageKeys.PRIVACY_MODE]: 'masked_cloud',
    [StorageKeys.PII_SANITIZE_LOGS]: false,
  };

  it('a degenerate AI result maps to a record carrying the fallback, not the spam', async () => {
    const degenerate = Array.from({ length: 200 }, () => '豚肉').join(' | ');
    // @ts-expect-error partial AIService mock
    const pipeline = new PrivacyPipeline(settings, makeAi(degenerate), mockSanitizers);
    const privacyResult = await pipeline.process('content', {});

    const { mapToBrowsingLogRecord } = await import(
      '../pipeline/mappers/BrowsingLogRecordMapper.js'
    );
    const record = mapToBrowsingLogRecord({
      data: { url: 'https://example.com', title: 't', content: 'c' },
      privacyResult,
      settings: {},
    } as never);

    expect(record.summary).toBe(DEGENERATE_SUMMARY_FALLBACK);
    expect(record.summary).not.toContain('豚肉 | 豚肉');
  });
});
