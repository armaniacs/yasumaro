import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resyncLegacyFromSqlite,
  mapSqliteRecordToLegacyPatch,
  DEFAULT_LEGACY_RESYNC_MAX_RECORDS,
  MAX_LEGACY_RESYNC_MAX_RECORDS,
} from '../legacyResync.js';
import { getSavedUrlEntries, saveSavedUrlEntryMetadata } from '../../../utils/storage/savedUrlRepository.js';
import { StorageKeys } from '../../../utils/storage/types.js';
import type { SqliteClient } from '../../sqlite/offscreenGateway.js';
import type { BrowsingLogRecord } from '../../../utils/sqlite-types.js';

function makeRecord(url: string, created_at: number, extra: Partial<BrowsingLogRecord> = {}): BrowsingLogRecord {
  return { url, created_at, ...extra };
}

/** Fake SqliteClient.query that honours limit + created_at ordering like the real backend. */
function makeSqliteClient(rows: BrowsingLogRecord[]) {
  const sorted = [...rows].sort((a, b) => b.created_at - a.created_at);
  return {
    query: vi.fn(async (q?: { limit?: number }) => {
      const limit = q?.limit ?? sorted.length;
      return { success: true, data: { rows: sorted.slice(0, limit), total: rows.length } } as const;
    }),
  };
}

describe('mapSqliteRecordToLegacyPatch', () => {
  it('maps a fully populated SQLite record (reverse of mapLegacyEntryToRecord)', () => {
    const patch = mapSqliteRecordToLegacyPatch(makeRecord('https://example.com', 1_700_000_000_000, {
      title: null,
      summary: 'summary text',
      tags: '#a #b',
      content: 'raw content',
      masked_count: 3,
      cleansed_reason: 'hard',
      ai_provider: 'openai',
      ai_model: 'gpt-4',
      ai_duration_ms: 1200,
      obsidian_duration_ms: 300,
      sent_tokens: 100,
      received_tokens: 50,
      original_tokens: 120,
      cleansed_tokens: 80,
      page_bytes: 5000,
      candidate_bytes: 4000,
      original_bytes: 5500,
      cleansed_bytes: 3500,
      ai_summary_original_bytes: 200,
      ai_summary_cleansed_bytes: 150,
      fallback_triggered: 1,
    }));
    expect(patch.tags).toEqual(['a', 'b']);
    expect(patch.aiSummary).toBe('summary text');
    expect(patch.content).toBe('raw content');
    expect(patch.maskedCount).toBe(3);
    expect(patch.cleansedReason).toBe('hard');
    expect(patch.aiProvider).toBe('openai');
    expect(patch.aiModel).toBe('gpt-4');
    expect(patch.aiDuration).toBe(1200);
    expect(patch.obsidianDuration).toBe(300);
    expect(patch.sentTokens).toBe(100);
    expect(patch.receivedTokens).toBe(50);
    expect(patch.originalTokens).toBe(120);
    expect(patch.cleansedTokens).toBe(80);
    expect(patch.pageBytes).toBe(5000);
    expect(patch.candidateBytes).toBe(4000);
    expect(patch.originalBytes).toBe(5500);
    expect(patch.cleansedBytes).toBe(3500);
    expect(patch.aiSummaryOriginalBytes).toBe(200);
    expect(patch.aiSummaryCleansedBytes).toBe(150);
    expect(patch.fallbackTriggered).toBe(true);
  });

  it('parses legacy comma-separated tags too', () => {
    const patch = mapSqliteRecordToLegacyPatch(makeRecord('https://example.com', 1, { tags: 'a, b' }));
    expect(patch.tags).toEqual(['a', 'b']);
  });

  it('maps a minimal record to a near-empty patch', () => {
    const patch = mapSqliteRecordToLegacyPatch(makeRecord('https://example.com', 1));
    expect(patch.tags).toBeUndefined();
    expect(patch.aiSummary).toBeUndefined();
    expect(patch.sentTokens).toBeUndefined();
    expect(patch.fallbackTriggered).toBe(false);
  });

  it('omits maskedCount of 0 (mirrors toMetadataPatch semantics)', () => {
    const patch = mapSqliteRecordToLegacyPatch(makeRecord('https://example.com', 1, { masked_count: 0 }));
    expect(patch.maskedCount).toBeUndefined();
  });
});

describe('resyncLegacyFromSqlite', () => {
  beforeEach(async () => {
    await chrome.storage.local.remove('savedUrlsWithTimestamps');
    await chrome.storage.local.remove('savedUrlsWithTimestamps_version');
  });

  it('writes recent SQLite rows to the legacy store (happy path)', async () => {
    const rows = [
      makeRecord('https://a.com', 1_700_000_000_001, { summary: 'A', sent_tokens: 10 }),
      makeRecord('https://b.com', 1_700_000_000_002, { summary: 'B', tags: '#x' }),
      makeRecord('https://c.com', 1_700_000_000_003, { content: 'C' }),
    ];
    const result = await resyncLegacyFromSqlite(makeSqliteClient(rows) as unknown as SqliteClient);
    expect(result).toEqual({ examined: 3, written: 3, skipped: 0, total: 3 });

    const entries = await getSavedUrlEntries();
    expect(entries.map((e) => e.url).sort()).toEqual(['https://a.com', 'https://b.com', 'https://c.com']);
    const byUrl = new Map(entries.map((e) => [e.url, e]));
    // Original SQLite timestamps are preserved (not bumped to Date.now()).
    expect(byUrl.get('https://a.com')?.timestamp).toBe(1_700_000_000_001);
    expect(byUrl.get('https://a.com')?.aiSummary).toBe('A');
    expect(byUrl.get('https://b.com')?.tags).toEqual(['x']);
  });

  it('is idempotent: re-running changes nothing', async () => {
    const rows = [
      makeRecord('https://a.com', 1_700_000_000_001, { summary: 'A' }),
      makeRecord('https://b.com', 1_700_000_000_002, { summary: 'B' }),
    ];
    const client = makeSqliteClient(rows) as unknown as SqliteClient;
    const first = await resyncLegacyFromSqlite(client);
    const before = await getSavedUrlEntries();
    const second = await resyncLegacyFromSqlite(client);
    const after = await getSavedUrlEntries();
    expect(first).toEqual({ examined: 2, written: 2, skipped: 0, total: 2 });
    expect(second).toEqual({ examined: 2, written: 2, skipped: 0, total: 2 });
    expect(after).toHaveLength(before.length);
    expect(after).toEqual(before);
  });

  it('is bounded: honours maxRecords newest-first', async () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      makeRecord(`https://site${i}.com`, 1_700_000_000_000 + i));
    const result = await resyncLegacyFromSqlite(makeSqliteClient(rows) as unknown as SqliteClient, { maxRecords: 2 });
    expect(result).toEqual({ examined: 2, written: 2, skipped: 0, total: 5 });
    const entries = await getSavedUrlEntries();
    expect(entries.map((e) => e.url).sort()).toEqual(['https://site3.com', 'https://site4.com']);
  });

  it('clamps invalid maxRecords to the default and caps oversized values', async () => {
    const client = makeSqliteClient([makeRecord('https://a.com', 1)]) as unknown as SqliteClient;
    await resyncLegacyFromSqlite(client, { maxRecords: 0 });
    expect(client.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: DEFAULT_LEGACY_RESYNC_MAX_RECORDS }),
    );
    await resyncLegacyFromSqlite(client, { maxRecords: Number.MAX_SAFE_INTEGER });
    expect(client.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: MAX_LEGACY_RESYNC_MAX_RECORDS }),
    );
  });

  it('does not consult the dual-write flag: explicit trigger writes even when disabled', async () => {
    await chrome.storage.local.set({ settings: { [StorageKeys.LEGACY_DUAL_WRITE_ENABLED]: false } });
    const rows = [makeRecord('https://a.com', 1_700_000_000_001, { summary: 'A' })];
    const result = await resyncLegacyFromSqlite(makeSqliteClient(rows) as unknown as SqliteClient);
    expect(result.written).toBe(1);
    expect((await getSavedUrlEntries()).map((e) => e.url)).toEqual(['https://a.com']);
    await chrome.storage.local.remove('settings');
  });

  it('does not lose a concurrent new recording (CAS lock discipline)', async () => {
    const rows = [
      makeRecord('https://a.com', 1_700_000_000_001, { summary: 'A' }),
      makeRecord('https://b.com', 1_700_000_000_002, { summary: 'B' }),
    ];
    const client = makeSqliteClient(rows) as unknown as SqliteClient;
    await Promise.all([
      resyncLegacyFromSqlite(client),
      saveSavedUrlEntryMetadata('https://new.com', { aiSummary: 'new' }, { timestamp: 1_700_000_000_009 }),
    ]);
    const entries = await getSavedUrlEntries();
    expect(entries.map((e) => e.url).sort()).toEqual(['https://a.com', 'https://b.com', 'https://new.com']);
  });

  it('skips rows without a URL and keeps going', async () => {
    const rows = [
      makeRecord('', 1_700_000_000_001),
      makeRecord('https://ok.com', 1_700_000_000_002, { summary: 'ok' }),
    ];
    const result = await resyncLegacyFromSqlite(makeSqliteClient(rows) as unknown as SqliteClient);
    expect(result).toEqual({ examined: 2, written: 1, skipped: 1, total: 2 });
    expect((await getSavedUrlEntries()).map((e) => e.url)).toEqual(['https://ok.com']);
  });

  it('throws when the SQLite query fails', async () => {
    const client = {
      query: vi.fn(async () => ({ success: false, error: { message: 'db down' } })),
    } as unknown as SqliteClient;
    await expect(resyncLegacyFromSqlite(client)).rejects.toThrow('db down');
  });
});
