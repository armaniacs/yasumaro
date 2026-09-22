import { describe, it, expect } from 'vitest';
import {
  REGENERATE_UPDATE_FIELDS,
  buildRegenerateUpdateFields,
} from '../regenerateUpdateFields.js';
import type { BrowsingLogRecord } from '../../../../utils/sqlite-types.js';

function makeRecord(overrides: Partial<BrowsingLogRecord> = {}): BrowsingLogRecord {
  return {
    id: 7,
    url: 'https://example.com/page',
    title: 'Original title',
    domain: 'example.com',
    created_at: 1700000000000,
    is_starred: 1,
    is_deleted: 0,
    obsidian_synced: 1,
    gist_synced: 0,
    visit_duration: 123,
    scroll_ratio: 0.5,
    obsidian_duration_ms: 42,
    summary: 'new summary',
    content: 'new content',
    tags: '["a"]',
    page_bytes: 1000,
    candidate_bytes: 900,
    original_bytes: 800,
    cleansed_bytes: 400,
    ai_summary_original_bytes: 300,
    ai_summary_cleansed_bytes: 150,
    extracted_sentences_bytes: 120,
    extracted_sentences_original_bytes: 130,
    masked_count: 2,
    cleansed_reason: 'keyword',
    ai_provider: 'openai',
    ai_model: 'gpt-x',
    ai_duration_ms: 1500,
    sent_tokens: 100,
    received_tokens: 50,
    original_tokens: 110,
    cleansed_tokens: 60,
    fallback_triggered: 1,
    fallback_reason: 'over_cleansed',
    ...overrides,
  } as BrowsingLogRecord;
}

describe('REGENERATE_UPDATE_FIELDS (CRITICAL: update-never-insert whitelist)', () => {
  it('contains exactly the re-extraction-owned columns', () => {
    expect([...REGENERATE_UPDATE_FIELDS]).toEqual([
      'summary', 'content', 'tags',
      'page_bytes', 'candidate_bytes', 'original_bytes', 'cleansed_bytes',
      'ai_summary_original_bytes', 'ai_summary_cleansed_bytes',
      'extracted_sentences_bytes', 'extracted_sentences_original_bytes',
      'masked_count', 'cleansed_reason',
      'ai_provider', 'ai_model', 'ai_duration_ms',
      'sent_tokens', 'received_tokens', 'original_tokens', 'cleansed_tokens',
      'fallback_triggered', 'fallback_reason',
    ]);
  });

  it('never includes identity/history/user-state/visit columns', () => {
    const forbidden = [
      'id', 'url', 'title', 'domain', 'created_at', 'record_type',
      'is_starred', 'is_deleted', 'obsidian_synced', 'gist_synced',
      'visit_duration', 'scroll_ratio', 'obsidian_duration_ms',
    ];
    for (const f of forbidden) {
      expect(REGENERATE_UPDATE_FIELDS as readonly string[]).not.toContain(f);
    }
  });
});

describe('buildRegenerateUpdateFields', () => {
  it('projects exactly the whitelist (must not relabel auto rows as manual)', () => {
    const out = buildRegenerateUpdateFields(makeRecord());
    expect(Object.keys(out).sort()).toEqual([...REGENERATE_UPDATE_FIELDS].sort());
    expect(out.summary).toBe('new summary');
    expect(out.content).toBe('new content');
    expect(out.fallback_reason).toBe('over_cleansed');
    expect(out.fallback_triggered).toBe(1);
  });

  it('copies null/undefined through so stale diagnostics are cleared', () => {
    const out = buildRegenerateUpdateFields(
      makeRecord({ summary: null, ai_provider: null, fallback_reason: null }),
    );
    expect(out.summary).toBeNull();
    expect(out.ai_provider).toBeNull();
    expect(out.fallback_reason).toBeNull();
  });
});
