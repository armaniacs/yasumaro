/**
 * browsingLogCodec-comprehensive.test.ts
 * Comprehensive tests for buildRecordFromPayload — covers type coercion,
 * prototype pollution prevention, boundary values, and null/undefined handling.
 */

import { describe, it, expect } from 'vitest';
import { buildRecordFromPayload } from '../browsingLogCodec.js';
import { MAX_TAGS_PER_RECORD } from '../../utils/computeLimits.js';

describe('buildRecordFromPayload', () => {
  // ── Normal operation ─────────────────────────────────────────────────

  it('maps all known fields correctly', () => {
    const payload = {
      url: 'https://example.com',
      title: 'Title',
      summary: 'Summary',
      tags: '#tag1 #tag2',
      created_at: 1700000000000,
      domain: 'example.com',
      visit_duration: 30000,
      scroll_ratio: 0.75,
      is_starred: 1,
      is_deleted: 0,
      obsidian_synced: 1,
      gist_synced: 0,
      content: 'Page content',
      masked_count: 2,
      cleansed_reason: 'ads',
      ai_provider: 'openai',
      ai_model: 'gpt-4',
      ai_duration_ms: 1500,
      obsidian_duration_ms: 200,
      sent_tokens: 500,
      received_tokens: 200,
      original_tokens: 700,
      cleansed_tokens: 650,
      page_bytes: 50000,
      candidate_bytes: 45000,
      original_bytes: 50000,
      cleansed_bytes: 40000,
      ai_summary_original_bytes: 2000,
      ai_summary_cleansed_bytes: 1800,
      extracted_sentences_bytes: 3000,
      extracted_sentences_original_bytes: 3500,
      fallback_triggered: 1,
    };
    const record = buildRecordFromPayload(payload);
    expect(record.url).toBe('https://example.com');
    expect(record.title).toBe('Title');
    expect(record.summary).toBe('Summary');
    expect(record.tags).toBe('#tag1 #tag2');
    expect(record.created_at).toBe(1700000000000);
    expect(record.domain).toBe('example.com');
    expect(record.visit_duration).toBe(30000);
    expect(record.scroll_ratio).toBe(0.75);
    expect(record.is_starred).toBe(1);
    expect(record.is_deleted).toBe(0);
    expect(record.obsidian_synced).toBe(1);
    expect(record.gist_synced).toBe(0);
    expect(record.content).toBe('Page content');
    expect(record.masked_count).toBe(2);
    expect(record.cleansed_reason).toBe('ads');
    expect(record.ai_provider).toBe('openai');
    expect(record.ai_model).toBe('gpt-4');
    expect(record.ai_duration_ms).toBe(1500);
    expect(record.obsidian_duration_ms).toBe(200);
    expect(record.sent_tokens).toBe(500);
    expect(record.received_tokens).toBe(200);
    expect(record.original_tokens).toBe(700);
    expect(record.cleansed_tokens).toBe(650);
    expect(record.page_bytes).toBe(50000);
    expect(record.candidate_bytes).toBe(45000);
    expect(record.original_bytes).toBe(50000);
    expect(record.cleansed_bytes).toBe(40000);
    expect(record.ai_summary_original_bytes).toBe(2000);
    expect(record.ai_summary_cleansed_bytes).toBe(1800);
    expect(record.extracted_sentences_bytes).toBe(3000);
    expect(record.extracted_sentences_original_bytes).toBe(3500);
    expect(record.fallback_triggered).toBe(1);
  });

  // ── Type coercion ────────────────────────────────────────────────────

  it('coerces numeric strings to numbers', () => {
    const record = buildRecordFromPayload({
      url: 'https://test.com',
      created_at: 1000,
      visit_duration: '30000',
      scroll_ratio: '0.5',
      sent_tokens: '100',
    });
    expect(record.visit_duration).toBe(30000);
    expect(record.scroll_ratio).toBe(0.5);
    expect(record.sent_tokens).toBe(100);
  });

  it('coerces boolean to number for flag fields', () => {
    const record = buildRecordFromPayload({
      url: 'https://test.com',
      created_at: 1000,
      is_starred: true as unknown as number,
      is_deleted: false as unknown as number,
    });
    expect(record.is_starred).toBe(1);
    expect(record.is_deleted).toBe(0);
  });

  it('coerces 0 to number (not null)', () => {
    const record = buildRecordFromPayload({
      url: 'https://test.com',
      created_at: 1000,
      visit_duration: 0,
      scroll_ratio: 0,
      sent_tokens: 0,
    });
    expect(record.visit_duration).toBe(0);
    expect(record.scroll_ratio).toBe(0);
    expect(record.sent_tokens).toBe(0);
  });

  // ── Null/undefined defaults ──────────────────────────────────────────

  it('defaults optional text fields to null when absent', () => {
    const record = buildRecordFromPayload({
      url: 'https://test.com',
      created_at: 1000,
    });
    expect(record.title).toBeNull();
    expect(record.summary).toBeNull();
    expect(record.tags).toBeNull();
    expect(record.domain).toBeNull();
    expect(record.content).toBeNull();
    expect(record.cleansed_reason).toBeNull();
    expect(record.ai_provider).toBeNull();
    expect(record.ai_model).toBeNull();
  });

  it('defaults optional numeric fields to null when absent', () => {
    const record = buildRecordFromPayload({
      url: 'https://test.com',
      created_at: 1000,
    });
    expect(record.visit_duration).toBeNull();
    expect(record.scroll_ratio).toBeNull();
    expect(record.masked_count).toBeNull();
    expect(record.ai_duration_ms).toBeNull();
    expect(record.obsidian_duration_ms).toBeNull();
    expect(record.sent_tokens).toBeNull();
    expect(record.received_tokens).toBeNull();
  });

  it('defaults flag fields to 0 when absent', () => {
    const record = buildRecordFromPayload({
      url: 'https://test.com',
      created_at: 1000,
    });
    expect(record.is_starred).toBe(0);
    expect(record.is_deleted).toBe(0);
    expect(record.obsidian_synced).toBe(0);
    expect(record.gist_synced).toBe(0);
    expect(record.fallback_triggered).toBe(0);
  });

  it('defaults url to empty string when absent', () => {
    const record = buildRecordFromPayload({ created_at: 1000 });
    expect(record.url).toBe('');
  });

  it('defaults created_at to Date.now() when absent', () => {
    const before = Date.now();
    const record = buildRecordFromPayload({ url: 'https://test.com' });
    const after = Date.now();
    expect(record.created_at).toBeGreaterThanOrEqual(before);
    expect(record.created_at).toBeLessThanOrEqual(after);
  });

  // ── Prototype pollution prevention ───────────────────────────────────

  it('ignores __proto__ properties in payload', () => {
    const payload = {
      url: 'https://safe.com',
      created_at: 1000,
      __proto__: { polluted: true },
      constructor: { polluted: true },
    };
    const record = buildRecordFromPayload(payload);
    expect(record.url).toBe('https://safe.com');
    expect((record as any).polluted).toBeUndefined();
  });

  it('ignores unknown/extra properties (no spill-over)', () => {
    const record = buildRecordFromPayload({
      url: 'https://test.com',
      created_at: 1000,
      unknownField: 'should not appear',
      anotherExtra: 42,
    });
    expect('unknownField' in record).toBe(false);
    expect('anotherExtra' in record).toBe(false);
  });

  // ── Edge cases ───────────────────────────────────────────────────────

  it('handles empty payload object', () => {
    const record = buildRecordFromPayload({});
    expect(record.url).toBe('');
    expect(typeof record.created_at).toBe('number');
  });

  it('handles payload with all null values', () => {
    const record = buildRecordFromPayload({
      url: null,
      title: null,
      summary: null,
      tags: null,
      created_at: null,
      domain: null,
      visit_duration: null,
      scroll_ratio: null,
      is_starred: null,
      is_deleted: null,
      obsidian_synced: null,
      gist_synced: null,
      content: null,
      masked_count: null,
      cleansed_reason: null,
      ai_provider: null,
      ai_model: null,
      ai_duration_ms: null,
      obsidian_duration_ms: null,
      sent_tokens: null,
      received_tokens: null,
      original_tokens: null,
      cleansed_tokens: null,
      page_bytes: null,
      candidate_bytes: null,
      original_bytes: null,
      cleansed_bytes: null,
      ai_summary_original_bytes: null,
      ai_summary_cleansed_bytes: null,
      extracted_sentences_bytes: null,
      extracted_sentences_original_bytes: null,
      fallback_triggered: null,
    });
    // url: String(payload.url || '') — null || '' = '' → String('') = ''
    expect(record.url).toBe('');
    // Flags default to 0 when null (since null != null is false, null ?? 0 = 0)
    expect(record.is_starred).toBe(0);
  });

  it('handles payload with all undefined values', () => {
    const record = buildRecordFromPayload({
      url: undefined,
      title: undefined,
      created_at: undefined,
    });
    expect(record.url).toBe('');
    expect(record.title).toBeNull();
    expect(typeof record.created_at).toBe('number');
  });

  it('handles very large created_at (epoch ms)', () => {
    const future = new Date('2099-12-31T23:59:59.999Z').getTime();
    const record = buildRecordFromPayload({ url: 'https://x.com', created_at: future });
    expect(record.created_at).toBe(future);
  });

  it('handles negative created_at', () => {
    const record = buildRecordFromPayload({ url: 'https://x.com', created_at: -1 });
    expect(record.created_at).toBe(-1);
  });

  it('handles URL with special characters', () => {
    const record = buildRecordFromPayload({
      url: 'https://example.com/path?q=1&r=2#fragment',
      created_at: 1000,
    });
    expect(record.url).toBe('https://example.com/path?q=1&r=2#fragment');
  });

  it('handles very long string values', () => {
    const longStr = 'x'.repeat(100000);
    const record = buildRecordFromPayload({
      url: 'https://test.com',
      created_at: 1000,
      content: longStr,
      summary: longStr,
    });
    expect(record.content).toBe(longStr);
    expect(record.summary).toBe(longStr);
  });

  it('normalizes NaN from invalid numeric coercion to null', () => {
    const record = buildRecordFromPayload({
      url: 'https://test.com',
      created_at: 1000,
      visit_duration: 'not-a-number',
      scroll_ratio: {},
    });
    expect(record.visit_duration).toBeNull();
    expect(record.scroll_ratio).toBeNull();
  });

  it('normalizes Infinity to null', () => {
    const record = buildRecordFromPayload({
      url: 'https://test.com',
      created_at: 1000,
      visit_duration: Infinity,
    });
    expect(record.visit_duration).toBeNull();
  });

  it('caps stored tags to MAX_TAGS_PER_RECORD (VULN-041/053 write-path defense)', () => {
    const many = Array.from({ length: 500 }, (_, i) => `#t${i}`).join(' ');
    const record = buildRecordFromPayload({ url: 'https://test.com', created_at: 1, tags: many });
    expect(record.tags!.split(/\s+/).filter(Boolean).length).toBe(MAX_TAGS_PER_RECORD);
  });

  it('leaves a normal-size tag string untouched', () => {
    const record = buildRecordFromPayload({ url: 'https://test.com', created_at: 1, tags: '#a #b #c' });
    expect(record.tags).toBe('#a #b #c');
  });

  it('handles negative zero', () => {
    const record = buildRecordFromPayload({
      url: 'https://test.com',
      created_at: 1000,
      visit_duration: -0,
    });
    expect(Object.is(record.visit_duration, -0)).toBe(true);
  });
});
