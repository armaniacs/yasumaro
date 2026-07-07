import { describe, it, expect } from 'vitest';
import type { BrowsingLogRecord, BrowsingLogEntry } from '../../utils/sqlite-types.js';

describe('PBI-1: metadata type round-trip', () => {
  it('BrowsingLogRecord accepts all new fields', () => {
    const record: BrowsingLogRecord = {
      url: 'https://test.com',
      title: 'Test',
      summary: null,
      tags: null,
      created_at: Date.now(),
      domain: 'test.com',
      visit_duration: null,
      scroll_ratio: null,
      is_starred: 0,
      is_deleted: 0,
      // All new fields
      content: null,
      masked_count: 5,
      cleansed_reason: 'keyword',
      ai_provider: 'openai',
      ai_model: 'gpt-4',
      ai_duration_ms: 3000,
      obsidian_duration_ms: null,
      sent_tokens: 150,
      received_tokens: 75,
      original_tokens: 200,
      cleansed_tokens: 150,
      page_bytes: 5000,
      candidate_bytes: 2500,
      original_bytes: 4000,
      cleansed_bytes: 2000,
      ai_summary_original_bytes: 1000,
      ai_summary_cleansed_bytes: 800,
      extracted_sentences_bytes: 3000,
      extracted_sentences_original_bytes: 5000,
      fallback_triggered: 0,
    };

    // Verify all new fields are accessible
    expect(record.masked_count).toBe(5);
    expect(record.cleansed_reason).toBe('keyword');
    expect(record.ai_provider).toBe('openai');
    expect(record.ai_model).toBe('gpt-4');
    expect(record.ai_duration_ms).toBe(3000);
    expect(record.sent_tokens).toBe(150);
    expect(record.received_tokens).toBe(75);
    expect(record.original_tokens).toBe(200);
    expect(record.cleansed_tokens).toBe(150);
    expect(record.page_bytes).toBe(5000);
    expect(record.candidate_bytes).toBe(2500);
    expect(record.original_bytes).toBe(4000);
    expect(record.cleansed_bytes).toBe(2000);
    expect(record.ai_summary_original_bytes).toBe(1000);
    expect(record.ai_summary_cleansed_bytes).toBe(800);
    expect(record.extracted_sentences_bytes).toBe(3000);
    expect(record.extracted_sentences_original_bytes).toBe(5000);
    expect(record.fallback_triggered).toBe(0);
    expect(record.content).toBeNull();
  });

  it('new fields are optional (undefined allowed)', () => {
    const record: BrowsingLogRecord = {
      url: 'https://test.com',
      created_at: Date.now(),
    };

    expect(record.content).toBeUndefined();
    expect(record.ai_provider).toBeUndefined();
    expect(record.fallback_triggered).toBeUndefined();
  });

  it('BrowsingLogEntry inherits new fields', () => {
    const entry: BrowsingLogEntry = {
      id: 1,
      url: 'https://test.com',
      created_at: Date.now(),
      ai_provider: 'openai',
      sent_tokens: 100,
    };

    expect(entry.ai_provider).toBe('openai');
    expect(entry.sent_tokens).toBe(100);
  });
});
