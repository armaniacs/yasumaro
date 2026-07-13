import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mapToBrowsingLogRecord } from '../BrowsingLogRecordMapper.js';
import type { RecordingContext } from '../../types.js';
import type { PrivacyPipelineResult } from '../../../privacyPipeline.js';

function makeContext(overrides: Partial<RecordingContext> = {}): RecordingContext {
  return {
    data: {
      title: 'Test Page',
      url: 'https://www.example.com/path?q=1',
      content: 'Page content body',
    },
    settings: {
      content_storage_enabled: true,
    } as Record<string, unknown>,
    force: false,
    errors: [],
    ...overrides,
  };
}

function makePrivacyResult(overrides: Partial<PrivacyPipelineResult> = {}): PrivacyPipelineResult {
  return {
    summary: 'AI generated summary',
    tags: ['tech', 'test'],
    maskedCount: 3,
    aiProvider: 'openai',
    aiModel: 'gpt-4',
    sentTokens: 150,
    receivedTokens: 50,
    originalTokens: 200,
    cleansedTokens: 180,
    ...overrides,
  };
}

describe('mapToBrowsingLogRecord', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('basic field mapping', () => {
    it('maps url and title correctly', () => {
      const context = makeContext();
      const record = mapToBrowsingLogRecord(context);

      expect(record.url).toBe('https://www.example.com/path?q=1');
      expect(record.title).toBe('Test Page');
    });

    it('maps title to null when empty', () => {
      const context = makeContext({
        data: { title: '', url: 'https://example.com', content: 'body' },
      });
      const record = mapToBrowsingLogRecord(context);

      expect(record.title).toBeNull();
    });

    it('maps summary from privacyResult', () => {
      const context = makeContext({ privacyResult: makePrivacyResult() });
      const record = mapToBrowsingLogRecord(context);

      expect(record.summary).toBe('AI generated summary');
    });

    it('maps summary to null when not available', () => {
      const context = makeContext({ privacyResult: undefined });
      const record = mapToBrowsingLogRecord(context);

      expect(record.summary).toBeNull();
    });

    it('maps tags as space-joined #-prefixed string', () => {
      const context = makeContext({ privacyResult: makePrivacyResult() });
      const record = mapToBrowsingLogRecord(context);

      expect(record.tags).toBe('#tech #test');
    });

    it('maps tags to null when empty', () => {
      const context = makeContext({ privacyResult: makePrivacyResult({ tags: [] }) });
      const record = mapToBrowsingLogRecord(context);

      expect(record.tags).toBeNull();
    });

    it('maps tags to null when undefined', () => {
      const context = makeContext({ privacyResult: makePrivacyResult({ tags: undefined }) });
      const record = mapToBrowsingLogRecord(context);

      expect(record.tags).toBeNull();
    });

    it('sets created_at to current timestamp', () => {
      const context = makeContext();
      const record = mapToBrowsingLogRecord(context);

      expect(record.created_at).toBe(new Date('2026-07-13T00:00:00Z').getTime());
    });

    it('sets default static fields', () => {
      const context = makeContext();
      const record = mapToBrowsingLogRecord(context);

      expect(record.visit_duration).toBeNull();
      expect(record.scroll_ratio).toBeNull();
      expect(record.is_starred).toBe(0);
      expect(record.is_deleted).toBe(0);
    });
  });

  describe('domain extraction', () => {
    it('extracts domain without www prefix', () => {
      const context = makeContext({
        data: { title: 'T', url: 'https://www.example.com/page', content: 'body' },
      });
      const record = mapToBrowsingLogRecord(context);

      expect(record.domain).toBe('example.com');
    });

    it('extracts domain without www when no prefix', () => {
      const context = makeContext({
        data: { title: 'T', url: 'https://sub.example.com/page', content: 'body' },
      });
      const record = mapToBrowsingLogRecord(context);

      expect(record.domain).toBe('sub.example.com');
    });

    it('sets domain to null for invalid URL', () => {
      const context = makeContext({
        data: { title: 'T', url: 'not-a-valid-url', content: 'body' },
      });
      const record = mapToBrowsingLogRecord(context);

      expect(record.domain).toBeNull();
    });
  });

  describe('content field', () => {
    it('sets content from data.content when content_storage_enabled is true', () => {
      const context = makeContext();
      const record = mapToBrowsingLogRecord(context);

      expect(record.content).toBe('Page content body');
    });

    it('sets content to null when content_storage_enabled is false', () => {
      const context = makeContext({
        settings: { content_storage_enabled: false } as Record<string, unknown>,
      });
      const record = mapToBrowsingLogRecord(context);

      expect(record.content).toBeNull();
    });

    it('sets content to null when data.content is empty and enabled', () => {
      const context = makeContext({
        data: { title: 'T', url: 'https://example.com', content: '' },
      });
      const record = mapToBrowsingLogRecord(context);

      expect(record.content).toBeNull();
    });
  });

  describe('optional numeric fields', () => {
    it('maps masked_count from data.maskedCount', () => {
      const context = makeContext({
        data: { title: 'T', url: 'https://example.com', content: 'body', maskedCount: 5 },
      });
      const record = mapToBrowsingLogRecord(context);

      expect(record.masked_count).toBe(5);
    });

    it('falls back masked_count to privacyResult.maskedCount', () => {
      const context = makeContext({
        data: { title: 'T', url: 'https://example.com', content: 'body', maskedCount: undefined },
        privacyResult: makePrivacyResult({ maskedCount: 7 }),
      });
      const record = mapToBrowsingLogRecord(context);

      expect(record.masked_count).toBe(7);
    });

    it('sets masked_count to null when neither source available', () => {
      const context = makeContext({
        privacyResult: makePrivacyResult({ maskedCount: undefined }),
      });
      const record = mapToBrowsingLogRecord(context);

      expect(record.masked_count).toBeNull();
    });

    it('maps cleansed_reason from data', () => {
      const context = makeContext({
        data: { title: 'T', url: 'https://example.com', content: 'body', cleansedReason: 'hard' },
      });
      const record = mapToBrowsingLogRecord(context);

      expect(record.cleansed_reason).toBe('hard');
    });

    it('maps ai_provider and ai_model from privacyResult', () => {
      const context = makeContext({ privacyResult: makePrivacyResult() });
      const record = mapToBrowsingLogRecord(context);

      expect(record.ai_provider).toBe('openai');
      expect(record.ai_model).toBe('gpt-4');
    });

    it('maps ai_duration_ms and obsidian_duration_ms', () => {
      const context = makeContext({ aiDuration: 1234, obsidianDuration: 5678 });
      const record = mapToBrowsingLogRecord(context);

      expect(record.ai_duration_ms).toBe(1234);
      expect(record.obsidian_duration_ms).toBe(5678);
    });

    it('sets ai_duration_ms to null when undefined', () => {
      const context = makeContext({ aiDuration: undefined });
      const record = mapToBrowsingLogRecord(context);

      expect(record.ai_duration_ms).toBeNull();
    });

    it('maps token fields from privacyResult', () => {
      const context = makeContext({ privacyResult: makePrivacyResult() });
      const record = mapToBrowsingLogRecord(context);

      expect(record.sent_tokens).toBe(150);
      expect(record.received_tokens).toBe(50);
      expect(record.original_tokens).toBe(200);
      expect(record.cleansed_tokens).toBe(180);
    });

    it('maps page/candidate byte fields from data', () => {
      const context = makeContext({
        data: {
          title: 'T', url: 'https://example.com', content: 'body',
          pageBytes: 1000, candidateBytes: 800, originalBytes: 900, cleansedBytes: 700,
          aiSummaryOriginalBytes: 500, aiSummaryCleansedBytes: 300,
        },
      });
      const record = mapToBrowsingLogRecord(context);

      expect(record.page_bytes).toBe(1000);
      expect(record.candidate_bytes).toBe(800);
      expect(record.original_bytes).toBe(900);
      expect(record.cleansed_bytes).toBe(700);
      expect(record.ai_summary_original_bytes).toBe(500);
      expect(record.ai_summary_cleansed_bytes).toBe(300);
    });

    it('maps extraction byte fields', () => {
      const context = makeContext({ extractedSentencesBytes: 500, extractedSentencesOriginalBytes: 2000 });
      const record = mapToBrowsingLogRecord(context);

      expect(record.extracted_sentences_bytes).toBe(500);
      expect(record.extracted_sentences_original_bytes).toBe(2000);
    });

    it('maps fallback_triggered as 0 or 1', () => {
      const contextEnabled = makeContext({
        data: { title: 'T', url: 'https://example.com', content: 'body', fallbackTriggered: true },
      });
      const contextDisabled = makeContext({
        data: { title: 'T', url: 'https://example.com', content: 'body', fallbackTriggered: false },
      });

      expect(mapToBrowsingLogRecord(contextEnabled).fallback_triggered).toBe(1);
      expect(mapToBrowsingLogRecord(contextDisabled).fallback_triggered).toBe(0);
    });
  });

  describe('missing optional fields handling', () => {
    it('handles completely empty context gracefully', () => {
      const context = makeContext({
        privacyResult: undefined,
        aiDuration: undefined,
        obsidianDuration: undefined,
        extractedSentencesBytes: undefined,
        extractedSentencesOriginalBytes: undefined,
        data: {
          title: undefined as unknown as string,
          url: 'https://example.com',
          content: undefined as unknown as string,
        },
      });

      const record = mapToBrowsingLogRecord(context);

      expect(record.url).toBe('https://example.com');
      expect(record.title).toBeNull();
      expect(record.summary).toBeNull();
      expect(record.tags).toBeNull();
      expect(record.content).toBeNull();
      expect(record.cleansed_reason).toBeNull();
      expect(record.masked_count).toBeNull();
      expect(record.ai_provider).toBeNull();
      expect(record.ai_duration_ms).toBeNull();
      expect(record.extracted_sentences_bytes).toBeNull();
      expect(record.fallback_triggered).toBe(0);
    });
  });
});
