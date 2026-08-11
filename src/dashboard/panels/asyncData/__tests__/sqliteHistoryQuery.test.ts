/**
 * sqliteHistoryQuery.test.ts
 *
 * Tests for the unified history query module. The pure helpers are verified
 * with arguments and return values only (no DB mock, no jsdom); queryHistory()
 * is verified by injecting fake data sources through the test seam.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  buildEnrichmentKey,
  buildLegacyMetadataMap,
  enrichEntryWithChromeStorage,
  enrichRowsWithLegacyMetadata,
  filterRowsByTag,
  dateRangeFromSelectedDate,
  queryHistory,
} from '../sqliteHistoryQuery.js';
import type { BrowsingLogEntry } from '../../../../utils/sqlite-types.js';
import type { SavedUrlEntry } from '../../../../utils/storageUrls.js';

function makeEntry(over: Partial<BrowsingLogEntry> = {}): BrowsingLogEntry {
  return {
    id: 1,
    url: 'https://example.com/a',
    title: 'A',
    created_at: 1_700_000_000_000,
    ...over,
  } as BrowsingLogEntry;
}

function makeRow(id: number, over: Partial<BrowsingLogEntry> = {}): BrowsingLogEntry {
  return makeEntry({ id, url: `https://example.com/${id}`, ...over });
}

function legacyEntry(over: Partial<SavedUrlEntry> = {}): SavedUrlEntry {
  return { url: 'https://example.com/1', timestamp: 1_700_000_000_000, ...over } as SavedUrlEntry;
}

interface MockSources {
  queryLogs: ReturnType<typeof vi.fn>;
  searchLogs: ReturnType<typeof vi.fn>;
  getSavedUrlEntries: ReturnType<typeof vi.fn>;
}

function makeSources(over: Partial<MockSources> = {}): MockSources {
  return {
    queryLogs: vi.fn().mockResolvedValue({ data: { rows: [], total: 0 } }),
    searchLogs: vi.fn().mockResolvedValue({ data: { rows: [], total: 0 } }),
    getSavedUrlEntries: vi.fn().mockResolvedValue([]),
    ...over,
  };
}

describe('buildEnrichmentKey', () => {
  it('builds a key from the URL and the minute-rounded timestamp', () => {
    expect(buildEnrichmentKey('https://example.com', 120_000)).toBe('https://example.com|2');
  });

  it('maps different milliseconds in the same minute to the same key', () => {
    const a = buildEnrichmentKey('https://example.com', 120_000);
    const b = buildEnrichmentKey('https://example.com', 179_999);
    expect(a).toBe(b);
  });

  it('uses different keys across a minute boundary', () => {
    const a = buildEnrichmentKey('https://example.com', 179_999);
    const b = buildEnrichmentKey('https://example.com', 180_000);
    expect(a).not.toBe(b);
  });
});

describe('buildLegacyMetadataMap', () => {
  it('keys each entry by url and its own minute bucket', () => {
    const entry = legacyEntry({ url: 'https://example.com/x', timestamp: 120_000 });
    const map = buildLegacyMetadataMap([entry]);
    expect(map.get(buildEnrichmentKey('https://example.com/x', 120_000))).toBe(entry);
  });

  it('keeps the last entry when two entries collide on the same bucket', () => {
    const first = legacyEntry({ url: 'https://example.com/x', timestamp: 120_000, sentTokens: 1 });
    const second = legacyEntry({ url: 'https://example.com/x', timestamp: 179_999, sentTokens: 2 });
    const map = buildLegacyMetadataMap([first, second]);
    expect(map.get(buildEnrichmentKey('https://example.com/x', 150_000))?.sentTokens).toBe(2);
  });
});

describe('enrichEntryWithChromeStorage', () => {
  it('returns the same reference when diagnostic metadata already exists', () => {
    const entry = makeEntry({ sent_tokens: 100 });
    const result = enrichEntryWithChromeStorage(entry, new Map());
    expect(result).toBe(entry);
  });

  it('returns the same reference when no storage entry matches', () => {
    const entry = makeEntry();
    const result = enrichEntryWithChromeStorage(entry, new Map());
    expect(result).toBe(entry);
  });

  it('fills missing fields from the matching storage entry', () => {
    const entry = makeEntry({ created_at: 120_000 });
    const map = new Map<string, SavedUrlEntry>([
      [buildEnrichmentKey('https://example.com/a', 120_000), {
        url: 'https://example.com/a',
        timestamp: 120_000,
        sentTokens: 42,
        aiProvider: 'gemini',
        fallbackTriggered: true,
      } as SavedUrlEntry],
    ]);

    const result = enrichEntryWithChromeStorage(entry, map);
    expect(result).not.toBe(entry);
    expect(result.sent_tokens).toBe(42);
    expect(result.ai_provider).toBe('gemini');
    expect(result.fallback_triggered).toBe(1);
  });

  it('prefers the SQLite value over the storage value', () => {
    // ai_model is outside the early-return fields, so it proves left priority.
    const entry = makeEntry({ created_at: 120_000, ai_model: 'sqlite-model' });
    const map = new Map<string, SavedUrlEntry>([
      [buildEnrichmentKey('https://example.com/a', 120_000), {
        url: 'https://example.com/a',
        timestamp: 120_000,
        aiModel: 'storage-model',
      } as SavedUrlEntry],
    ]);

    expect(enrichEntryWithChromeStorage(entry, map).ai_model).toBe('sqlite-model');
  });

  it('maps fallbackTriggered false to 0', () => {
    const entry = makeEntry({ created_at: 120_000 });
    const map = new Map<string, SavedUrlEntry>([
      [buildEnrichmentKey('https://example.com/a', 120_000), {
        url: 'https://example.com/a',
        timestamp: 120_000,
        fallbackTriggered: false,
      } as SavedUrlEntry],
    ]);

    expect(enrichEntryWithChromeStorage(entry, map).fallback_triggered).toBe(0);
  });
});

describe('enrichRowsWithLegacyMetadata', () => {
  function mapFor(...entries: SavedUrlEntry[]): Map<string, SavedUrlEntry> {
    return buildLegacyMetadataMap(entries);
  }

  it('enriches only the newest row when several share a url+minute bucket', () => {
    const older = makeRow(1, { url: 'https://example.com/x', created_at: 120_000 });
    const newer = makeRow(2, { url: 'https://example.com/x', created_at: 150_000 });
    const map = mapFor(legacyEntry({ url: 'https://example.com/x', timestamp: 150_000, sentTokens: 42 }));

    const [olderResult, newerResult] = enrichRowsWithLegacyMetadata([older, newer], map);
    expect(newerResult.sent_tokens).toBe(42);
    expect(olderResult.sent_tokens).toBeUndefined();
  });

  it('breaks a created_at tie by the higher id', () => {
    const lowId = makeRow(3, { url: 'https://example.com/x', created_at: 120_000 });
    const highId = makeRow(5, { url: 'https://example.com/x', created_at: 120_000 });
    const map = mapFor(legacyEntry({ url: 'https://example.com/x', timestamp: 120_000, sentTokens: 7 }));

    const [lowResult, highResult] = enrichRowsWithLegacyMetadata([lowId, highId], map);
    expect(highResult.sent_tokens).toBe(7);
    expect(lowResult.sent_tokens).toBeUndefined();
  });

  it('enriches rows in distinct minute buckets independently', () => {
    const rowA = makeRow(1, { url: 'https://example.com/x', created_at: 120_000 });
    const rowB = makeRow(2, { url: 'https://example.com/x', created_at: 180_000 });
    const map = mapFor(
      legacyEntry({ url: 'https://example.com/x', timestamp: 120_000, sentTokens: 1 }),
      legacyEntry({ url: 'https://example.com/x', timestamp: 180_000, sentTokens: 2 }),
    );

    const [resultA, resultB] = enrichRowsWithLegacyMetadata([rowA, rowB], map);
    expect(resultA.sent_tokens).toBe(1);
    expect(resultB.sent_tokens).toBe(2);
  });

  it('does not enrich a row that already carries SQLite metadata', () => {
    const row = makeRow(1, { url: 'https://example.com/x', created_at: 120_000, sent_tokens: 99 });
    const map = mapFor(legacyEntry({ url: 'https://example.com/x', timestamp: 120_000, sentTokens: 42 }));

    expect(enrichRowsWithLegacyMetadata([row], map)[0]).toBe(row);
  });

  it('keeps rows untouched when no legacy metadata matches', () => {
    const row = makeRow(1, { url: 'https://example.com/x', created_at: 120_000 });
    const [result] = enrichRowsWithLegacyMetadata([row], new Map());
    expect(result).toBe(row);
  });
});

describe('filterRowsByTag', () => {
  it('matches partial tags inside a comma-separated tags string', () => {
    const rows = [
      makeEntry({ id: 1, tags: 'typescript,testing' }),
      makeEntry({ id: 2, tags: 'rust' }),
      makeEntry({ id: 3, tags: 'test' }),
    ];
    expect(filterRowsByTag(rows, 'test').map(r => r.id)).toEqual([1, 3]);
  });

  it('ignores whitespace around tags', () => {
    const rows = [makeEntry({ id: 1, tags: 'a, spaced ,b' })];
    expect(filterRowsByTag(rows, 'spaced')).toHaveLength(1);
  });

  it('excludes rows with unset or empty tags', () => {
    const rows = [makeEntry({ id: 1 }), makeEntry({ id: 2, tags: '' })];
    expect(filterRowsByTag(rows, 'x')).toEqual([]);
  });

  it('returns an empty array when nothing matches', () => {
    const rows = [makeEntry({ tags: 'a,b' })];
    expect(filterRowsByTag(rows, 'zzz')).toEqual([]);
  });
});

describe('dateRangeFromSelectedDate', () => {
  it('returns an empty range object (all time) when no date is selected', () => {
    expect(dateRangeFromSelectedDate(null)).toEqual({});
  });

  it('converts a selected date into the local-time range for that day', () => {
    const range = dateRangeFromSelectedDate('2026-08-08');
    const start = new Date('2026-08-08T00:00:00').getTime();
    expect(range.since).toBe(start);
    expect(range.until).toBe(start + 86_400_000 - 1);
  });

  it('does not overlap the next day', () => {
    const day = dateRangeFromSelectedDate('2026-08-08');
    const next = dateRangeFromSelectedDate('2026-08-09');
    expect(day.until! + 1).toBe(next.since!);
  });
});

describe('queryHistory', () => {
  const baseOptions = { limit: 20, offset: 0 };

  it('uses the full-text search source and enriches its rows', async () => {
    const sources = makeSources({
      searchLogs: vi.fn().mockResolvedValue({
        data: {
          rows: [makeRow(1, { sent_tokens: null })],
          total: 1,
        },
      }),
      getSavedUrlEntries: vi.fn().mockResolvedValue([
        legacyEntry({ url: 'https://example.com/1', timestamp: 1_700_000_001_000, sentTokens: 42 }),
      ]),
    });

    const result = await queryHistory({ ...baseOptions, search: 'rust' }, sources);

    expect(sources.searchLogs).toHaveBeenCalledWith('rust', 20, 0);
    expect(sources.queryLogs).not.toHaveBeenCalled();
    expect(result).toEqual({
      data: {
        rows: [expect.objectContaining({ sent_tokens: 42 })],
        total: 1,
      },
    });
  });

  it('pages in SQL when no tag filter is active', async () => {
    const sources = makeSources({
      queryLogs: vi.fn().mockResolvedValue({
        data: { rows: [makeRow(1)], total: 1 },
      }),
    });

    const result = await queryHistory({ ...baseOptions, since: 10, until: 20 }, sources);

    expect(sources.queryLogs).toHaveBeenCalledWith({
      limit: 20,
      offset: 0,
      since: 10,
      until: 20,
      orderBy: 'created_at',
      orderDir: 'DESC',
    });
    expect(result).toEqual({ data: { rows: [makeRow(1)], total: 1 } });
  });

  it('keeps the tag filter client-side with a wide fetch window', async () => {
    const sources = makeSources({
      queryLogs: vi.fn().mockResolvedValue({
        data: {
          rows: [makeRow(1, { tags: '#AI' }), makeRow(2, { tags: '#other' })],
          total: 2,
        },
      }),
    });

    const result = await queryHistory({ ...baseOptions, tagFilter: 'AI' }, sources);

    const options = sources.queryLogs.mock.calls[0]![0];
    // A 2-character tag would return nothing through FTS5 trigram MATCH.
    expect(options.tagFilter).toBeUndefined();
    expect(options.limit).toBe(5000);
    expect(options.offset).toBe(0);
    expect(result).toEqual({
      data: { rows: [makeRow(1, { tags: '#AI' })], total: 1 },
    });
  });

  it('slices the client-side filter result by offset and limit', async () => {
    const tagged = Array.from({ length: 50 }, (_, i) => makeRow(i, { tags: 'AI' }));
    const sources = makeSources({
      queryLogs: vi.fn().mockResolvedValue({ data: { rows: tagged, total: 50 } }),
    });

    const result = await queryHistory({ limit: 20, offset: 20, tagFilter: 'AI' }, sources);

    expect(sources.searchLogs).not.toHaveBeenCalled();
    expect(result).toEqual({
      data: { rows: tagged.slice(20, 40), total: 50 },
    });
  });

  it('does not fall back to search when the tag filter has matches', async () => {
    const sources = makeSources({
      queryLogs: vi.fn().mockResolvedValue({
        data: { rows: [makeRow(1, { tags: 'tech' })], total: 1 },
      }),
    });

    const result = await queryHistory({ ...baseOptions, tagFilter: 'tech', tagInitiated: true }, sources);

    expect(sources.searchLogs).not.toHaveBeenCalled();
    expect(result).toEqual({ data: { rows: [makeRow(1, { tags: 'tech' })], total: 1 } });
  });

  it('falls back to full-text search and reports the notice when tag matches nothing', async () => {
    const sources = makeSources({
      queryLogs: vi.fn().mockResolvedValue({
        data: { rows: [makeRow(1, { tags: 'tech' })], total: 1 },
      }),
      searchLogs: vi.fn().mockResolvedValue({
        data: { rows: [makeRow(10)], total: 54 },
      }),
    });

    const result = await queryHistory({ ...baseOptions, tagFilter: '教育', tagInitiated: true }, sources);

    expect(sources.searchLogs).toHaveBeenCalledWith('教育', 20, 0);
    expect(result.data.tagFallback).toEqual({
      searchQuery: '教育',
      pendingTagFallback: { tag: '教育', fallbackTo: '教育', matched: 54 },
    });
    expect(result.data.total).toBe(54);
  });

  it('suppresses the notice when the fallback search matches nothing', async () => {
    const sources = makeSources({
      queryLogs: vi.fn().mockResolvedValue({ data: { rows: [], total: 0 } }),
      searchLogs: vi.fn().mockResolvedValue({ data: { rows: [], total: 0 } }),
    });

    const result = await queryHistory({ ...baseOptions, tagFilter: 'nonexistent', tagInitiated: true }, sources);

    expect(sources.searchLogs).toHaveBeenCalledWith('nonexistent', 20, 0);
    expect(result.data.tagFallback).toEqual({
      searchQuery: 'nonexistent',
      pendingTagFallback: null,
    });
    expect(result.data.rows).toEqual([]);
  });

  it('returns the fallback search error instead of raw over-fetched rows', async () => {
    const rawRows = [makeRow(1, { tags: 'tech' })];
    const sources = makeSources({
      queryLogs: vi.fn().mockResolvedValue({ data: { rows: rawRows, total: 1 } }),
      searchLogs: vi.fn().mockResolvedValue({ error: 'Search failed' }),
    });

    const result = await queryHistory({ ...baseOptions, tagFilter: '教育', tagInitiated: true }, sources);

    // A failed fallback search must surface the error; the raw over-fetched
    // rows must not leak into the successful result.
    expect(result).toEqual({ error: 'Search failed' });
  });

  it('returns an empty result (no fallback) for a manual tag filter with no matches', async () => {
    const sources = makeSources({
      queryLogs: vi.fn().mockResolvedValue({
        data: { rows: [makeRow(1, { tags: 'tech' })], total: 1 },
      }),
    });

    const result = await queryHistory({ ...baseOptions, tagFilter: 'nonexistent' }, sources);

    expect(sources.searchLogs).not.toHaveBeenCalled();
    expect(result).toEqual({ data: { rows: [], total: 0 } });
  });

  it('propagates a SQLite query failure as an error', async () => {
    const sources = makeSources({
      queryLogs: vi.fn().mockResolvedValue({ error: 'Query failed' }),
    });

    const result = await queryHistory(baseOptions, sources);

    expect(result).toEqual({ error: 'Query failed' });
  });

  it('propagates a search failure as an error', async () => {
    const sources = makeSources({
      searchLogs: vi.fn().mockResolvedValue({ error: 'Search failed' }),
    });

    const result = await queryHistory({ ...baseOptions, search: 'rust' }, sources);

    expect(result).toEqual({ error: 'Search failed' });
  });

  it('still returns the SQLite rows when the legacy metadata source fails', async () => {
    const rows = [makeRow(1)];
    const sources = makeSources({
      queryLogs: vi.fn().mockResolvedValue({ data: { rows, total: 1 } }),
      getSavedUrlEntries: vi.fn().mockRejectedValue(new Error('storage read failed')),
    });

    const result = await queryHistory(baseOptions, sources);

    expect(result).toEqual({ data: { rows, total: 1 } });
  });

  it('skips the legacy metadata read when there are no rows', async () => {
    const sources = makeSources({
      queryLogs: vi.fn().mockResolvedValue({ data: { rows: [], total: 0 } }),
    });

    const result = await queryHistory(baseOptions, sources);

    expect(sources.getSavedUrlEntries).not.toHaveBeenCalled();
    expect(result).toEqual({ data: { rows: [], total: 0 } });
  });

  it('enriches only the newest row of a shared bucket through the full query', async () => {
    const older = makeRow(1, { url: 'https://example.com/x', created_at: 120_000, sent_tokens: null });
    const newer = makeRow(2, { url: 'https://example.com/x', created_at: 150_000, sent_tokens: null });
    const sources = makeSources({
      queryLogs: vi.fn().mockResolvedValue({ data: { rows: [older, newer], total: 2 } }),
      getSavedUrlEntries: vi.fn().mockResolvedValue([
        legacyEntry({ url: 'https://example.com/x', timestamp: 150_000, sentTokens: 42 }),
      ]),
    });

    const result = await queryHistory(baseOptions, sources);

    const rows = (result.data as { rows: BrowsingLogEntry[] }).rows;
    expect(rows[0]).toBe(older);
    expect(rows[1].sent_tokens).toBe(42);
  });
});
