/**
 * pipelineText.test.ts (PBI-17)
 * Unit tests for the single-owner selectPipelineText priority plus
 * cross-step parity: the same context fed to extractSentencesStep and
 * formatMarkdownStep must resolve to the same text.
 */

import { vi } from 'vitest';;
import type { Mock } from 'vitest';

vi.mock('../../../utils/sentenceExtractor.js', () => ({
  getCompressionStats: vi.fn(),
}));
vi.mock('../../../utils/sentenceExtractorHybrid.js', () => ({
  extractSentencesHybrid: vi.fn(),
}));
vi.mock('../../../utils/localeUtils.js', () => ({
  getUserLocale: vi.fn().mockReturnValue('en-US'),
}));

import { getCompressionStats } from '../../../utils/sentenceExtractor.js';
import { extractSentencesHybrid } from '../../../utils/sentenceExtractorHybrid.js';
import { selectPipelineText, PIPELINE_TEXT_EMPTY_FALLBACK } from '../pipelineText.js';
import { extractSentencesStep } from '../steps/extractSentencesStep.js';
import { formatMarkdownStep } from '../steps/formatMarkdownStep.js';
import type { RecordingContext } from '../types.js';

function source(overrides = {}) {
  return {
    extractedSentences: undefined,
    sanitizedSummary: undefined,
    privacyResult: undefined,
    truncatedContent: undefined,
    ...overrides,
  };
}

function fullContext(overrides: Partial<RecordingContext>): RecordingContext {
  return {
    data: { url: 'https://example.com/page', title: 'Test Page', content: 'C' },
    settings: {},
    force: false,
    errors: [],
    ...overrides,
  } as RecordingContext;
}

describe('selectPipelineText priority table', () => {
  it('prefers extractedSentences joined with \\n\\n when all sources present', () => {
    const text = selectPipelineText(
      source({
        extractedSentences: ['L0-A', 'L0-B'],
        sanitizedSummary: 'sanitized',
        privacyResult: { summary: 'privacy' },
        truncatedContent: 'truncated',
      }),
    );

    expect(text).toBe('L0-A\n\nL0-B');
  });

  it('falls back to sanitizedSummary when extractedSentences is empty', () => {
    const text = selectPipelineText(
      source({
        extractedSentences: [],
        sanitizedSummary: 'sanitized',
        privacyResult: { summary: 'privacy' },
      }),
    );

    expect(text).toBe('sanitized');
  });

  it('falls back to privacyResult.summary when sanitizedSummary is empty string', () => {
    const text = selectPipelineText(
      source({
        sanitizedSummary: '',
        privacyResult: { summary: 'privacy' },
        truncatedContent: 'truncated',
      }),
    );

    expect(text).toBe('privacy');
  });

  it('falls back to truncatedContent when upper sources are missing', () => {
    const text = selectPipelineText(
      source({ truncatedContent: 'truncated' }),
    );

    expect(text).toBe('truncated');
  });

  it('returns empty string when all sources are empty', () => {
    expect(selectPipelineText(source({}))).toBe('');
    expect(selectPipelineText(source({ sanitizedSummary: '', truncatedContent: '' }))).toBe('');
  });

  it('keeps the display fallback literal byte-equal', () => {
    expect(PIPELINE_TEXT_EMPTY_FALLBACK).toBe('Summary not available.');
    expect(PIPELINE_TEXT_EMPTY_FALLBACK.length).toBe(22);
    expect(selectPipelineText(source({})) || PIPELINE_TEXT_EMPTY_FALLBACK).toBe(
      'Summary not available.',
    );
  });
});

describe('step parity via selectPipelineText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getCompressionStats as Mock).mockReturnValue({
      originalLength: 100,
      extractedLength: 50,
      compressionRatio: 2,
      sentenceCount: 5,
      extractedCount: 2,
    });
    (extractSentencesHybrid as Mock).mockResolvedValue(['SENT-X']);
  });

  it('both steps select sanitizedSummary-derived text for the same context', async () => {
    const ctx = fullContext({
      extractedSentences: [],
      sanitizedSummary: 'PARITY-SUMMARY-TEXT',
      privacyResult: { summary: 'PARITY-PRIVACY', maskedCount: 0 } as any,
      truncatedContent: 'PARITY-TRUNCATED',
    });

    await extractSentencesStep(ctx);
    const formatted = await formatMarkdownStep(ctx);

    expect((extractSentencesHybrid as Mock).mock.calls[0][0]).toBe('PARITY-SUMMARY-TEXT');
    expect(formatted.markdownEntryData?.summary).toBe('PARITY-SUMMARY-TEXT');
  });

  it('both steps select truncatedContent when upper sources are missing', async () => {
    const ctx = fullContext({
      sanitizedSummary: undefined,
      privacyResult: undefined,
      truncatedContent: 'PARITY-TRUNCATED',
    });

    await extractSentencesStep(ctx);
    const formatted = await formatMarkdownStep(ctx);

    expect((extractSentencesHybrid as Mock).mock.calls[0][0]).toBe('PARITY-TRUNCATED');
    expect(formatted.markdownEntryData?.summary).toBe('PARITY-TRUNCATED');
  });

  it('all empty: extraction skipped, format shows the byte-equal fallback', async () => {
    const ctx = fullContext({
      sanitizedSummary: '',
      privacyResult: undefined,
      truncatedContent: '',
    });

    const extracted = await extractSentencesStep(ctx);
    const formatted = await formatMarkdownStep(ctx);

    expect(extractSentencesHybrid).not.toHaveBeenCalled();
    expect(extracted.extractedSentences).toBeUndefined();
    expect(formatted.markdownEntryData?.summary).toBe('Summary not available.');
    expect(formatted.markdown).toContain('Summary not available.');
  });
});
