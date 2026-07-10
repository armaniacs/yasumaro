/**
 * schema-insertParams.test.ts
 * PBI 2026-07-09-09: shared buildInsertParams() builder used across
 * sqlite.ts / opfsWorker.ts / storageFallback.ts.
 */
import { describe, it, expect } from 'vitest';
import { COLUMN_NAMES, buildInsertParams, buildInsertRecordFields, type InsertableRecord } from '../schema.js';

function minimalRecord(overrides: Partial<InsertableRecord> = {}): InsertableRecord {
  return {
    url: 'https://example.com',
    created_at: 1000,
    ...overrides,
  };
}

describe('buildInsertParams', () => {
  it('returns an array with one entry per COLUMN_NAMES entry', () => {
    const params = buildInsertParams(minimalRecord(), 'example.com');
    expect(params).toHaveLength(COLUMN_NAMES.length);
  });

  it('places domain at the position matching its slot in COLUMN_NAMES', () => {
    const params = buildInsertParams(minimalRecord(), 'example.com');
    const domainIndex = COLUMN_NAMES.indexOf('domain');
    expect(params[domainIndex]).toBe('example.com');
  });

  it('passes domain through as-is, including null, without recomputing it', () => {
    const params = buildInsertParams(minimalRecord(), null);
    const domainIndex = COLUMN_NAMES.indexOf('domain');
    expect(params[domainIndex]).toBeNull();
  });

  it('defaults nullable text/number fields to null when omitted', () => {
    const params = buildInsertParams(minimalRecord(), 'example.com');
    const titleIndex = COLUMN_NAMES.indexOf('title');
    const summaryIndex = COLUMN_NAMES.indexOf('summary');
    const aiModelIndex = COLUMN_NAMES.indexOf('ai_model');
    expect(params[titleIndex]).toBeNull();
    expect(params[summaryIndex]).toBeNull();
    expect(params[aiModelIndex]).toBeNull();
  });

  it('defaults flag-like fields (is_starred, is_deleted, obsidian_synced, gist_synced, fallback_triggered) to 0 when omitted', () => {
    const params = buildInsertParams(minimalRecord(), 'example.com');
    const flagFields = ['is_starred', 'is_deleted', 'obsidian_synced', 'gist_synced', 'fallback_triggered'] as const;
    for (const field of flagFields) {
      const index = COLUMN_NAMES.indexOf(field);
      expect(params[index]).toBe(0);
    }
  });

  it('preserves explicit values for flag-like fields instead of overwriting with the default', () => {
    const params = buildInsertParams(
      minimalRecord({ is_starred: 1, is_deleted: 1, obsidian_synced: 1, gist_synced: 1, fallback_triggered: 1 }),
      'example.com'
    );
    const flagFields = ['is_starred', 'is_deleted', 'obsidian_synced', 'gist_synced', 'fallback_triggered'] as const;
    for (const field of flagFields) {
      const index = COLUMN_NAMES.indexOf(field);
      expect(params[index]).toBe(1);
    }
  });

  it('passes through all diagnostic metadata fields in the correct order', () => {
    const record = minimalRecord({
      content: 'page content',
      masked_count: 3,
      cleansed_reason: 'ads',
      ai_provider: 'openai',
      ai_model: 'gpt-4',
      ai_duration_ms: 500,
      obsidian_duration_ms: 100,
      sent_tokens: 10,
      received_tokens: 20,
      original_tokens: 30,
      cleansed_tokens: 25,
      page_bytes: 1000,
      candidate_bytes: 900,
      original_bytes: 1000,
      cleansed_bytes: 800,
      ai_summary_original_bytes: 700,
      ai_summary_cleansed_bytes: 600,
      extracted_sentences_bytes: 400,
      extracted_sentences_original_bytes: 500,
    });
    const params = buildInsertParams(record, 'example.com');

    const expectedByColumn: Record<string, unknown> = {
      content: 'page content',
      masked_count: 3,
      cleansed_reason: 'ads',
      ai_provider: 'openai',
      ai_model: 'gpt-4',
      ai_duration_ms: 500,
      obsidian_duration_ms: 100,
      sent_tokens: 10,
      received_tokens: 20,
      original_tokens: 30,
      cleansed_tokens: 25,
      page_bytes: 1000,
      candidate_bytes: 900,
      original_bytes: 1000,
      cleansed_bytes: 800,
      ai_summary_original_bytes: 700,
      ai_summary_cleansed_bytes: 600,
      extracted_sentences_bytes: 400,
      extracted_sentences_original_bytes: 500,
    };
    for (const [column, expected] of Object.entries(expectedByColumn)) {
      const index = COLUMN_NAMES.indexOf(column as typeof COLUMN_NAMES[number]);
      expect(params[index]).toBe(expected);
    }
  });

  it('passes created_at and url through unchanged (required fields)', () => {
    const params = buildInsertParams(minimalRecord({ url: 'https://a.com', created_at: 12345 }), 'a.com');
    expect(params[COLUMN_NAMES.indexOf('url')]).toBe('https://a.com');
    expect(params[COLUMN_NAMES.indexOf('created_at')]).toBe(12345);
  });
});

describe('buildInsertRecordFields', () => {
  it('produces an object with the same values buildInsertParams would produce, keyed by column name', () => {
    const record = minimalRecord({
      title: 'Example',
      is_starred: 1,
      gist_synced: 1,
      content: 'body text',
    });
    const params = buildInsertParams(record, 'example.com');
    const fields = buildInsertRecordFields(record, 'example.com');

    COLUMN_NAMES.forEach((column, index) => {
      expect(fields[column]).toBe(params[index]);
    });
  });

  it('defaults flag-like fields to 0 and text fields to null when omitted', () => {
    const fields = buildInsertRecordFields(minimalRecord(), 'example.com');

    expect(fields.is_starred).toBe(0);
    expect(fields.is_deleted).toBe(0);
    expect(fields.obsidian_synced).toBe(0);
    expect(fields.gist_synced).toBe(0);
    expect(fields.fallback_triggered).toBe(0);
    expect(fields.title).toBeNull();
    expect(fields.content).toBeNull();
  });

  it('carries domain through as provided, including null', () => {
    const withDomain = buildInsertRecordFields(minimalRecord(), 'example.com');
    const withoutDomain = buildInsertRecordFields(minimalRecord(), null);

    expect(withDomain.domain).toBe('example.com');
    expect(withoutDomain.domain).toBeNull();
  });

  it('preserves required url and created_at fields unchanged', () => {
    const fields = buildInsertRecordFields(
      minimalRecord({ url: 'https://required.com', created_at: 999 }),
      'required.com'
    );

    expect(fields.url).toBe('https://required.com');
    expect(fields.created_at).toBe(999);
  });
});
