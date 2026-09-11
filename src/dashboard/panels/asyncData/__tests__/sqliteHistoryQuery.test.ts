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
  dateRangeFromSelectedDate,
  queryHistory,
} from '../sqliteHistoryQuery.js';
import { tagMatchesFilter } from '../../../../offscreen/queryPlan.js';
import type { BrowsingLogEntry } from '../../../../utils/sqlite-types.js';
import type { SavedUrlEntry } from '../../../../utils/storageUrls.js';
import type { HistoryQuerySources, UnifiedHistoryQueryData, UnifiedHistoryQueryResult } from '../sqliteHistoryQuery.js';

const asSources = (s: MockSources): HistoryQuerySources => s as unknown as HistoryQuerySources;
function okData(result: UnifiedHistoryQueryResult): UnifiedHistoryQueryData {
  if ('error' in result) throw new Error(`expected ok result, got error: ${result.error}`);
  return result.data;
}

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
    expect(newerResult!.sent_tokens).toBe(42);
    expect(olderResult!.sent_tokens).toBeUndefined();
  });

  it('breaks a created_at tie by the higher id', () => {
    const lowId = makeRow(3, { url: 'https://example.com/x', created_at: 120_000 });
    const highId = makeRow(5, { url: 'https://example.com/x', created_at: 120_000 });
    const map = mapFor(legacyEntry({ url: 'https://example.com/x', timestamp: 120_000, sentTokens: 7 }));

    const [lowResult, highResult] = enrichRowsWithLegacyMetadata([lowId, highId], map);
    expect(highResult!.sent_tokens).toBe(7);
    expect(lowResult!.sent_tokens).toBeUndefined();
  });

  it('enriches rows in distinct minute buckets independently', () => {
    const rowA = makeRow(1, { url: 'https://example.com/x', created_at: 120_000 });
    const rowB = makeRow(2, { url: 'https://example.com/x', created_at: 180_000 });
    const map = mapFor(
      legacyEntry({ url: 'https://example.com/x', timestamp: 120_000, sentTokens: 1 }),
      legacyEntry({ url: 'https://example.com/x', timestamp: 180_000, sentTokens: 2 }),
    );

    const [resultA, resultB] = enrichRowsWithLegacyMetadata([rowA, rowB], map);
    expect(resultA!.sent_tokens).toBe(1);
    expect(resultB!.sent_tokens).toBe(2);
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

describe('tagMatchesFilter (tag predicate — moved to the SQL layer, PBI 2026-09-11)', () => {
  it('matches partial tags inside a comma-separated tags string', () => {
    expect(tagMatchesFilter('typescript,testing', 'test')).toBe(true);
    expect(tagMatchesFilter('rust', 'test')).toBe(false);
    expect(tagMatchesFilter('test', 'test')).toBe(true);
  });

  it('ignores whitespace around tags', () => {
    expect(tagMatchesFilter('a, spaced ,b', 'spaced')).toBe(true);
  });

  it('excludes rows with unset or empty tags', () => {
    expect(tagMatchesFilter(null, 'x')).toBe(false);
    expect(tagMatchesFilter(undefined, 'x')).toBe(false);
    expect(tagMatchesFilter('', 'x')).toBe(false);
  });

  it('returns false when nothing matches', () => {
    expect(tagMatchesFilter('a,b', 'zzz')).toBe(false);
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

    const result = await queryHistory({ ...baseOptions, search: 'rust' }, asSources(sources));

    expect(sources.searchLogs).toHaveBeenCalledWith('rust', 20, 0, { orderBy: 'rank', orderDir: 'DESC' });
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

    const result = await queryHistory({ ...baseOptions, since: 10, until: 20 }, asSources(sources));

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

  it('pushes the tag filter to the SQL layer (no over-fetch window)', async () => {
    const sources = makeSources({
      queryLogs: vi.fn().mockResolvedValue({
        data: {
          rows: [makeRow(1, { tags: '#AI' })],
          total: 1,
        },
      }),
    });

    const result = await queryHistory({ ...baseOptions, tagFilter: 'AI' }, asSources(sources));

    const options = sources.queryLogs.mock.calls[0]![0];
    // PBI 2026-09-11: the tag filter travels on the wire; the panel pages
    // exactly like the non-tag path (SQL LIMIT/OFFSET, no 5000 fetch window).
    expect(options.tagFilter).toBe('AI');
    expect(options.limit).toBe(20);
    expect(options.offset).toBe(0);
    expect(result).toEqual({
      data: { rows: [makeRow(1, { tags: '#AI' })], total: 1 },
    });
  });

  it('pages tag-filtered queries with SQL LIMIT/OFFSET (no client-side slice)', async () => {
    const page = Array.from({ length: 20 }, (_, i) => makeRow(i, { tags: 'AI' }));
    const sources = makeSources({
      queryLogs: vi.fn().mockResolvedValue({ data: { rows: page, total: 50 } }),
    });

    const result = await queryHistory({ limit: 20, offset: 20, tagFilter: 'AI' }, asSources(sources));

    expect(sources.queryLogs).toHaveBeenCalledWith(expect.objectContaining({ limit: 20, offset: 20, tagFilter: 'AI' }));
    expect(sources.searchLogs).not.toHaveBeenCalled();
    expect(result).toEqual({
      data: { rows: page, total: 50 },
    });
  });

  it('does not fall back to search when the tag filter has matches', async () => {
    const sources = makeSources({
      queryLogs: vi.fn().mockResolvedValue({
        data: { rows: [makeRow(1, { tags: 'tech' })], total: 1 },
      }),
    });

    const result = await queryHistory({ ...baseOptions, tagFilter: 'tech', tagInitiated: true }, asSources(sources));

    expect(sources.queryLogs).toHaveBeenCalledWith(expect.objectContaining({ tagFilter: 'tech' }));
    expect(sources.searchLogs).not.toHaveBeenCalled();
    expect(result).toEqual({ data: { rows: [makeRow(1, { tags: 'tech' })], total: 1 } });
  });

  it('falls back to full-text search when the SQL tag query returns nothing (tag-initiated)', async () => {
    const sources = makeSources({
      queryLogs: vi.fn().mockResolvedValue({
        data: { rows: [], total: 0 },
      }),
      searchLogs: vi.fn().mockResolvedValue({
        data: { rows: [makeRow(10)], total: 54 },
      }),
    });

    const result = await queryHistory({ ...baseOptions, tagFilter: '教育', tagInitiated: true }, asSources(sources));

    expect(sources.searchLogs).toHaveBeenCalledWith('教育', 20, 0, { orderBy: 'rank', orderDir: 'DESC' });
    expect(okData(result).tagFallback).toEqual({
      searchQuery: '教育',
      pendingTagFallback: { tag: '教育', fallbackTo: '教育', matched: 54 },
    });
    expect(okData(result).total).toBe(54);
  });

  it('suppresses the notice when the fallback search matches nothing', async () => {
    const sources = makeSources({
      queryLogs: vi.fn().mockResolvedValue({ data: { rows: [], total: 0 } }),
      searchLogs: vi.fn().mockResolvedValue({ data: { rows: [], total: 0 } }),
    });

    const result = await queryHistory({ ...baseOptions, tagFilter: 'nonexistent', tagInitiated: true }, asSources(sources));

    expect(sources.searchLogs).toHaveBeenCalledWith('nonexistent', 20, 0, { orderBy: 'rank', orderDir: 'DESC' });
    expect(okData(result).tagFallback).toEqual({
      searchQuery: 'nonexistent',
      pendingTagFallback: null,
    });
    expect(okData(result).rows).toEqual([]);
  });

  it('returns the fallback search error instead of unrelated rows', async () => {
    const sources = makeSources({
      queryLogs: vi.fn().mockResolvedValue({ data: { rows: [], total: 0 } }),
      searchLogs: vi.fn().mockResolvedValue({ error: 'Search failed' }),
    });

    const result = await queryHistory({ ...baseOptions, tagFilter: '教育', tagInitiated: true }, asSources(sources));

    // A failed fallback search must surface the error; the empty SQL result
    // must not leak into a successful result.
    expect(result).toEqual({ error: 'Search failed' });
  });

  it('returns an empty result (no fallback) for a manual tag filter with no matches', async () => {
    const sources = makeSources({
      queryLogs: vi.fn().mockResolvedValue({
        data: { rows: [], total: 0 },
      }),
    });

    const result = await queryHistory({ ...baseOptions, tagFilter: 'nonexistent' }, asSources(sources));

    expect(sources.searchLogs).not.toHaveBeenCalled();
    expect(result).toEqual({ data: { rows: [], total: 0 } });
  });

  it('propagates a SQLite query failure as an error', async () => {
    const sources = makeSources({
      queryLogs: vi.fn().mockResolvedValue({ error: 'Query failed' }),
    });

    const result = await queryHistory(baseOptions, asSources(sources));

    expect(result).toEqual({ error: 'Query failed' });
  });

  it('propagates a search failure as an error', async () => {
    const sources = makeSources({
      searchLogs: vi.fn().mockResolvedValue({ error: 'Search failed' }),
    });

    const result = await queryHistory({ ...baseOptions, search: 'rust' }, asSources(sources));

    expect(result).toEqual({ error: 'Search failed' });
  });

  it('still returns the SQLite rows when the legacy metadata source fails', async () => {
    const rows = [makeRow(1)];
    const sources = makeSources({
      queryLogs: vi.fn().mockResolvedValue({ data: { rows, total: 1 } }),
      getSavedUrlEntries: vi.fn().mockRejectedValue(new Error('storage read failed')),
    });

    const result = await queryHistory(baseOptions, asSources(sources));

    expect(result).toEqual({ data: { rows, total: 1 } });
  });

  it('skips the legacy metadata read when there are no rows', async () => {
    const sources = makeSources({
      queryLogs: vi.fn().mockResolvedValue({ data: { rows: [], total: 0 } }),
    });

    const result = await queryHistory(baseOptions, asSources(sources));

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

    const result = await queryHistory(baseOptions, asSources(sources));

    const rows = okData(result).rows;
    expect(rows[0]).toBe(older);
    expect(rows[1]!.sent_tokens).toBe(42);
  });

  it('passes sortBy=created_at/sortDir=ASC through to queryLogs as orderBy/orderDir on the non-search path', async () => {
    const sources = makeSources();
    await queryHistory({ limit: 20, offset: 0, sortBy: 'created_at', sortDir: 'ASC' }, asSources(sources));
    expect(sources.queryLogs).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: 'created_at', orderDir: 'ASC' })
    );
  });

  it('defaults to created_at DESC on the non-search path when sortBy/sortDir are omitted', async () => {
    const sources = makeSources();
    await queryHistory({ limit: 20, offset: 0 }, asSources(sources));
    expect(sources.queryLogs).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: 'created_at', orderDir: 'DESC' })
    );
  });

  it('passes orderBy=created_at/orderDir to searchLogs when sortBy=created_at on the search path', async () => {
    const sources = makeSources();
    await queryHistory({ search: 'kddi', limit: 20, offset: 0, sortBy: 'created_at', sortDir: 'ASC' }, asSources(sources));
    expect(sources.searchLogs).toHaveBeenCalledWith('kddi', 20, 0, { orderBy: 'created_at', orderDir: 'ASC' });
  });

  it('passes orderBy=rank to searchLogs when sortBy=relevance on the search path', async () => {
    const sources = makeSources();
    await queryHistory({ search: 'kddi', limit: 20, offset: 0, sortBy: 'relevance', sortDir: 'DESC' }, asSources(sources));
    expect(sources.searchLogs).toHaveBeenCalledWith('kddi', 20, 0, { orderBy: 'rank', orderDir: 'DESC' });
  });

  it('defaults to orderBy=rank on the search path when sortBy is omitted', async () => {
    const sources = makeSources();
    await queryHistory({ search: 'kddi', limit: 20, offset: 0 }, asSources(sources));
    expect(sources.searchLogs).toHaveBeenCalledWith('kddi', 20, 0, { orderBy: 'rank', orderDir: 'DESC' });
  });

  it('forwards sortDir into the tag-filter over-fetch query (not hardcoded to DESC)', async () => {
    const sources = makeSources({ queryLogs: vi.fn().mockResolvedValue({ data: { rows: [], total: 0 } }) });
    await queryHistory({ limit: 20, offset: 0, tagFilter: 'work', sortDir: 'ASC' }, asSources(sources));
    expect(sources.queryLogs).toHaveBeenCalledWith(
      expect.objectContaining({ orderDir: 'ASC' })
    );
  });
});
