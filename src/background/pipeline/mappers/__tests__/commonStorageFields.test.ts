import { describe, it, expect } from 'vitest';
import { extractCommonStorageFields } from '../commonStorageFields.js';
import type { RecordingContext } from '../../types.js';

function makeContext(overrides: Partial<RecordingContext> = {}): RecordingContext {
  return {
    data: {
      title: 'Test Page',
      url: 'https://example.com/page',
      content: 'Page content',
      recordType: 'auto',
    },
    settings: {} as Record<string, unknown>,
    force: false,
    errors: [],
    ...overrides,
  };
}

describe('extractCommonStorageFields', () => {
  it('extracts all 40 fields from a fully populated context', () => {
    const context = makeContext({
      aiDuration: 100,
      obsidianDuration: 200,
      extractedSentencesBytes: 300,
      extractedSentencesOriginalBytes: 350,
      data: {
        title: 'Test',
        url: 'https://example.com/page',
        content: 'Page content',
        recordType: 'auto',
        maskedCount: 3,
        pageBytes: 1000,
        candidateBytes: 800,
        originalBytes: 1200,
        cleansedBytes: 900,
        aiSummaryOriginalBytes: 500,
        aiSummaryCleansedBytes: 400,
        aiSummaryCleansedElements: 5,
        aiSummaryCleansedReason: 'hard',
        aiSummaryCleansedReasons: ['reason1'],
        fallbackTriggered: true,
        cleansedReason: 'soft',
      },
      privacyResult: {
        summary: 'AI summary',
        maskedCount: 2,
        tags: ['tag1', 'tag2'],
        providerName: 'openai',
        modelName: 'gpt-4',
        mode: 'full_pipeline',
        sentTokens: 100,
        receivedTokens: 50,
        originalTokens: 200,
        cleansedTokens: 150,
      } as any,
    });

    const common = extractCommonStorageFields(context);

    expect(common).toMatchObject({
      url: 'https://example.com/page',
      title: 'Test',
      content: 'Page content',
      summary: 'AI summary',
      tagsArray: ['tag1', 'tag2'],
      providerName: 'openai',
      modelName: 'gpt-4',
      privacyMode: 'full_pipeline',
      maskedCount: 3,
      maskedCountForPatch: 3,
      sentTokens: 100,
      receivedTokens: 50,
      originalTokens: 200,
      cleansedTokens: 150,
      pageBytes: 1000,
      candidateBytes: 800,
      originalBytes: 1200,
      cleansedBytes: 900,
      aiSummaryOriginalBytes: 500,
      aiSummaryCleansedBytes: 400,
      aiSummaryCleansedElements: 5,
      aiSummaryCleansedReason: 'hard',
      aiSummaryCleansedReasons: ['reason1'],
      fallbackTriggered: true,
      fallbackTriggeredInt: 1,
      aiDuration: 100,
      obsidianDuration: 200,
      extractedSentencesBytes: 300,
      extractedSentencesOriginalBytes: 350,
      cleansedReason: 'soft',
      recordType: 'auto',
    });
  });

  describe('maskedCount 0 preservation (|| vs ?? bug)', () => {
    it('keeps maskedCount:0 instead of collapsing it to null when precomputedMaskedCount is 0', () => {
      const context = makeContext({
        data: {
          title: 'Test', url: 'https://example.com', content: '',
          precomputedMaskedCount: 0,
        } as any,
      });

      const common = extractCommonStorageFields(context);

      expect(common.maskedCount).toBe(0);
    });

    it('keeps maskedCount:0 instead of collapsing it to null when data.maskedCount is 0', () => {
      const context = makeContext({
        data: { title: 'Test', url: 'https://example.com', content: '', maskedCount: 0 },
      });

      const common = extractCommonStorageFields(context);

      expect(common.maskedCount).toBe(0);
    });

    it('keeps maskedCount:0 instead of collapsing it to null when privacyResult.maskedCount is 0', () => {
      const context = makeContext({
        privacyResult: { summary: '', maskedCount: 0 } as any,
      });

      const common = extractCommonStorageFields(context);

      expect(common.maskedCount).toBe(0);
    });

    it('sets maskedCount to null when no source provides a value', () => {
      const context = makeContext();

      const common = extractCommonStorageFields(context);

      expect(common.maskedCount).toBeNull();
    });

    it('sets maskedCountForPatch to undefined when maskedCount is 0 (patch should omit zero)', () => {
      const context = makeContext({
        data: { title: 'Test', url: 'https://example.com', content: '', maskedCount: 0 },
      });

      const common = extractCommonStorageFields(context);

      expect(common.maskedCountForPatch).toBeUndefined();
    });
  });

  describe('toBrowsingLogRecord', () => {
    it('includes content when contentEnabled is true', () => {
      const context = makeContext();
      const common = extractCommonStorageFields(context);

      const record = common.toBrowsingLogRecord(true);

      expect(record.content).toBe('Page content');
    });

    it('excludes content when contentEnabled is false', () => {
      const context = makeContext();
      const common = extractCommonStorageFields(context);

      const record = common.toBrowsingLogRecord(false);

      expect(record.content).toBeNull();
    });

    it('maps tags to a space-joined #-prefixed string', () => {
      const context = makeContext({
        privacyResult: { summary: '', maskedCount: null, tags: ['a', 'b'] } as any,
      });
      const common = extractCommonStorageFields(context);

      const record = common.toBrowsingLogRecord(true);

      expect(record.tags).toBe('#a #b');
    });

    it('extracts domain from url', () => {
      const context = makeContext({
        data: { title: 'T', url: 'https://www.example.com/page', content: 'body' },
      });
      const common = extractCommonStorageFields(context);

      const record = common.toBrowsingLogRecord(true);

      expect(record.domain).toBe('example.com');
    });
  });

  describe('toMetadataPatch', () => {
    it('omits maskedCount from the patch when it is 0 (matches existing patch semantics)', () => {
      const context = makeContext({
        data: { title: 'Test', url: 'https://example.com', content: '', maskedCount: 0 },
      });
      const common = extractCommonStorageFields(context);

      const patch = common.toMetadataPatch();

      expect('maskedCount' in patch).toBe(false);
    });

    it('includes maskedCount in the patch when it is a positive number', () => {
      const context = makeContext({
        data: { title: 'Test', url: 'https://example.com', content: '', maskedCount: 5 },
      });
      const common = extractCommonStorageFields(context);

      const patch = common.toMetadataPatch();

      expect(patch.maskedCount).toBe(5);
    });

    it('omits content from the patch when empty', () => {
      const context = makeContext({
        data: { title: 'Test', url: 'https://example.com', content: '' },
      });
      const common = extractCommonStorageFields(context);

      const patch = common.toMetadataPatch();

      expect('content' in patch).toBe(false);
    });

    it('omits tags from the patch when empty array', () => {
      const context = makeContext({
        privacyResult: { summary: '', maskedCount: 0, tags: [] } as any,
      });
      const common = extractCommonStorageFields(context);

      const patch = common.toMetadataPatch();

      expect('tags' in patch).toBe(false);
    });

    it('omits aiSummary from the patch when privacyResult.summary is absent', () => {
      const context = makeContext({
        privacyResult: { summary: undefined, maskedCount: 0 } as any,
      });
      const common = extractCommonStorageFields(context);

      const patch = common.toMetadataPatch();

      expect('aiSummary' in patch).toBe(false);
    });

    it('always includes recordType and fallbackTriggered', () => {
      const context = makeContext({
        data: { title: 'Test', url: 'https://example.com', content: '', recordType: undefined },
      });
      const common = extractCommonStorageFields(context);

      const patch = common.toMetadataPatch();

      expect(patch.recordType).toBe('auto');
      expect(patch.fallbackTriggered).toBe(false);
    });

    it('includes all numeric byte/token/duration fields when present', () => {
      const context = makeContext({
        aiDuration: 100,
        obsidianDuration: 200,
        extractedSentencesBytes: 300,
        extractedSentencesOriginalBytes: 350,
        data: {
          title: 'Test', url: 'https://example.com/page', content: 'Page content',
          recordType: 'auto',
          pageBytes: 1000, candidateBytes: 800, originalBytes: 1200, cleansedBytes: 900,
          aiSummaryOriginalBytes: 500, aiSummaryCleansedBytes: 400,
          aiSummaryCleansedElements: 5, aiSummaryCleansedReason: 'hard',
          aiSummaryCleansedReasons: ['reason1'],
        },
        privacyResult: {
          summary: 'AI summary', maskedCount: 2, tags: ['tag1'],
          providerName: 'openai', modelName: 'gpt-4', mode: 'full_pipeline',
          sentTokens: 100, receivedTokens: 50, originalTokens: 200, cleansedTokens: 150,
        } as any,
      });
      const common = extractCommonStorageFields(context);

      const patch = common.toMetadataPatch();

      expect(patch).toEqual(expect.objectContaining({
        recordType: 'auto',
        maskedCount: 2,
        content: 'Page content',
        tags: ['tag1'],
        aiSummary: 'AI summary',
        originalTokens: 200,
        cleansedTokens: 150,
        sentTokens: 100,
        receivedTokens: 50,
        pageBytes: 1000,
        candidateBytes: 800,
        originalBytes: 1200,
        cleansedBytes: 900,
        aiSummaryOriginalBytes: 500,
        aiSummaryCleansedBytes: 400,
        aiSummaryCleansedElements: 5,
        aiSummaryCleansedReason: 'hard',
        aiSummaryCleansedReasons: ['reason1'],
        fallbackTriggered: false,
        aiProvider: 'openai',
        aiModel: 'gpt-4',
        privacyMode: 'full_pipeline',
        extractedSentencesBytes: 300,
        extractedSentencesOriginalBytes: 350,
        aiDuration: 100,
        obsidianDuration: 200,
      }));
    });
  });
});
