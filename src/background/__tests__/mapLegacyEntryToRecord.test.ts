import { describe, it, expect } from 'vitest';
import { mapLegacyEntryToRecord } from '../migrationService.js';

describe('mapLegacyEntryToRecord', () => {
  it('maps url and timestamp to the SQLite record', () => {
    const record = mapLegacyEntryToRecord({ url: 'https://example.com', timestamp: 1700000000000 });
    expect(record.url).toBe('https://example.com');
    expect(record.created_at).toBe(1700000000000);
  });

  it('maps aiSummary to summary', () => {
    const record = mapLegacyEntryToRecord({
      url: 'https://e.com', timestamp: 1, aiSummary: 'a concise summary',
    });
    expect(record.summary).toBe('a concise summary');
  });

  it('joins the tags array into a comma-separated string', () => {
    const record = mapLegacyEntryToRecord({
      url: 'https://e.com', timestamp: 1, tags: ['IT・プログラミング', 'インフラ'],
    });
    expect(record.tags).toBe('IT・プログラミング, インフラ');
  });

  it('leaves summary and tags null when the legacy entry has none', () => {
    const record = mapLegacyEntryToRecord({ url: 'https://e.com', timestamp: 1 });
    expect(record.summary).toBeNull();
    expect(record.tags).toBeNull();
  });

  it('treats an empty tags array as null', () => {
    const record = mapLegacyEntryToRecord({ url: 'https://e.com', timestamp: 1, tags: [] });
    expect(record.tags).toBeNull();
  });

  it('leaves domain null so the SQLite layer derives it from the url', () => {
    const record = mapLegacyEntryToRecord({ url: 'https://e.com/x', timestamp: 1 });
    expect(record.domain).toBeNull();
  });

  it('defaults is_starred and is_deleted to 0', () => {
    const record = mapLegacyEntryToRecord({ url: 'https://e.com', timestamp: 1 });
    expect(record.is_starred).toBe(0);
    expect(record.is_deleted).toBe(0);
  });

  it('maps diagnostic metadata fields from legacy entry', () => {
    const record = mapLegacyEntryToRecord({
      url: 'https://e.com', timestamp: 1,
      sentTokens: 1200, receivedTokens: 500,
      aiProvider: 'openai', aiModel: 'gpt-4',
      aiDuration: 3200, pageBytes: 44000, candidateBytes: 8000,
      originalTokens: 800, cleansedTokens: 750,
      originalBytes: 8000, cleansedBytes: 7500,
      aiSummaryOriginalBytes: 7500, aiSummaryCleansedBytes: 5000,
      content: 'extracted text', maskedCount: 2, cleansedReason: 'hard',
      fallbackTriggered: true,
    });
    expect(record.sent_tokens).toBe(1200);
    expect(record.received_tokens).toBe(500);
    expect(record.ai_provider).toBe('openai');
    expect(record.ai_model).toBe('gpt-4');
    expect(record.ai_duration_ms).toBe(3200);
    expect(record.page_bytes).toBe(44000);
    expect(record.candidate_bytes).toBe(8000);
    expect(record.original_tokens).toBe(800);
    expect(record.cleansed_tokens).toBe(750);
    expect(record.original_bytes).toBe(8000);
    expect(record.cleansed_bytes).toBe(7500);
    expect(record.ai_summary_original_bytes).toBe(7500);
    expect(record.ai_summary_cleansed_bytes).toBe(5000);
    expect(record.content).toBe('extracted text');
    expect(record.masked_count).toBe(2);
    expect(record.cleansed_reason).toBe('hard');
    expect(record.fallback_triggered).toBe(1);
  });

  it('defaults diagnostic fields to null when not present', () => {
    const record = mapLegacyEntryToRecord({ url: 'https://e.com', timestamp: 1 });
    expect(record.sent_tokens).toBeNull();
    expect(record.received_tokens).toBeNull();
    expect(record.ai_provider).toBeNull();
    expect(record.ai_model).toBeNull();
    expect(record.ai_duration_ms).toBeNull();
    expect(record.page_bytes).toBeNull();
    expect(record.candidate_bytes).toBeNull();
    expect(record.content).toBeNull();
    expect(record.fallback_triggered).toBe(0);
  });
});
