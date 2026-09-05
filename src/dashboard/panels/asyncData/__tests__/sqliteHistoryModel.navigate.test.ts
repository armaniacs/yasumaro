import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSqliteHistoryModel } from '../sqliteHistoryModel.js';
import type { BrowsingLogEntry } from '../sqliteHistoryQuery.js';
import type { UnifiedHistoryQueryResult } from '../sqliteHistoryQuery.js';

function makeRow(id: number): BrowsingLogEntry {
  return { id, url: `https://example.com/${id}`, title: `Example ${id}`, created_at: 1700000000000 + id };
}

function okEmpty(): UnifiedHistoryQueryResult {
  return { data: { rows: [], total: 0 } };
}

beforeEach(() => {
  vi.clearAllMocks();
  (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
  (chrome.storage.local.set as unknown as ReturnType<typeof vi.fn>).mockClear();
});

describe('sqliteHistoryModel — narrowed lifecycle interface', () => {
  it('exposes onNavigateIn/onNavigateOut and hides the 8 plumbing methods (27 -> 21)', () => {
    const model = createSqliteHistoryModel({ queryHistory: vi.fn().mockResolvedValue(okEmpty()) });
    expect(typeof model.onNavigateIn).toBe('function');
    expect(typeof model.onNavigateOut).toBe('function');
    for (const hidden of [
      'checkFallbackStatus',
      'retryInitialLoad',
      'consumePendingInit',
      'activateWithTag',
      'activateWithDomain',
      'loadPersistedSortIntoState',
      'bumpGenerationOnUnmount',
      'resetFiltersForFreshLoad',
    ]) {
      expect(model).not.toHaveProperty(hidden);
    }
    expect(Object.keys(model)).toHaveLength(21);
  });
});

describe('onNavigateIn — tag hand-off finishes in one call', () => {
  it('activates the tag filter with exactly 1 underlying query (immediate fetch + cached retry)', async () => {
    const queryHistory = vi.fn().mockResolvedValue(okEmpty());
    const model = createSqliteHistoryModel({
      queryHistory,
      getSqliteStatus: vi.fn().mockResolvedValue({ fallback: false }),
    });
    await model.onNavigateIn({ searchTag: 'AI' });
    expect(model.getState().activeTagFilter).toBe('AI');
    expect(queryHistory).toHaveBeenCalledTimes(1);
  });

  it('does not leak the tag into the next plain navigation (exactly-once)', async () => {
    const queryHistory = vi.fn().mockResolvedValue(okEmpty());
    const model = createSqliteHistoryModel({
      queryHistory,
      getSqliteStatus: vi.fn().mockResolvedValue({ fallback: false }),
    });
    await model.onNavigateIn({ searchTag: 'AI' });
    await model.onNavigateIn({});
    expect(model.getState().activeTagFilter).toBeNull();
  });
});

describe('onNavigateIn — domain hand-off finishes in one call', () => {
  it('searches the domain with exactly 1 underlying query', async () => {
    const queryHistory = vi.fn().mockResolvedValue(okEmpty());
    const model = createSqliteHistoryModel({
      queryHistory,
      getSqliteStatus: vi.fn().mockResolvedValue({ fallback: false }),
    });
    await model.onNavigateIn({ searchDomain: 'example.com' });
    expect(model.getState().searchQuery).toBe('example.com');
    expect(queryHistory).toHaveBeenCalledTimes(1);
  });
});

describe('onNavigateIn — plain re-visit resets filters but keeps sort', () => {
  it('drops date/search/tag filters, preserves sort, checks fallback + persisted sort', async () => {
    const queryHistory = vi.fn().mockResolvedValue({ data: { rows: [makeRow(1)], total: 1 } });
    const getSqliteStatus = vi.fn().mockResolvedValue({ fallback: false });
    const model = createSqliteHistoryModel({ queryHistory, getSqliteStatus });
    await model.onNavigateIn({ searchTag: 'AI' });
    expect(model.getState().activeTagFilter).toBe('AI');

    await model.changeSort('created_at', 'ASC');
    await model.onNavigateIn({});
    const s = model.getState();
    expect(s.activeTagFilter).toBeNull();
    expect(s.searchQuery).toBe('');
    expect(s.selectedDate).toBeNull();
    expect(s.currentPage).toBe(0);
    expect(s.sortBy).toBe('created_at');
    expect(s.sortDir).toBe('ASC');
    expect(getSqliteStatus).toHaveBeenCalled();
    expect(chrome.storage.local.get).toHaveBeenCalledWith('history_sort_preference');
  });

  it('sets fallbackMode when status reports fallback, ignores status rejection', async () => {
    const fallback = createSqliteHistoryModel({
      queryHistory: vi.fn().mockResolvedValue(okEmpty()),
      getSqliteStatus: vi.fn().mockResolvedValue({ fallback: true }),
    });
    await fallback.onNavigateIn({});
    expect(fallback.getState().fallbackMode).toBe(true);

    const broken = createSqliteHistoryModel({
      queryHistory: vi.fn().mockResolvedValue(okEmpty()),
      getSqliteStatus: vi.fn().mockRejectedValue(new Error('down')),
    });
    await expect(broken.onNavigateIn({})).resolves.toBeUndefined();
    expect(broken.getState().fallbackMode).toBe(false);
  });
});

describe('onNavigateOut — teardown finishes in one call', () => {
  it('bumps generation so in-flight fetches are discarded', async () => {
    let resolvePending!: (v: UnifiedHistoryQueryResult) => void;
    const pending = new Promise<UnifiedHistoryQueryResult>(res => { resolvePending = res; });
    const queryHistory = vi.fn().mockReturnValueOnce(pending);
    const model = createSqliteHistoryModel({ queryHistory });
    const inFlight = model.fetchData({ page: 0 });
    model.onNavigateOut();
    resolvePending(okEmpty());
    await inFlight;
    expect(model.getState().entries).toEqual([]);
  });

  it('flushes pending sort persist, clears cache and entry selection', async () => {
    const queryHistory = vi.fn().mockResolvedValue({ data: { rows: [makeRow(1)], total: 1 } });
    const model = createSqliteHistoryModel({ queryHistory });
    await model.fetchData({ page: 0 });
    expect(queryHistory).toHaveBeenCalledTimes(1);

    model.selectEntry(1, true);
    expect(model.getState().selectedIds.size).toBe(1);

    model.onNavigateOut();
    expect(model.getState().selectedIds.size).toBe(0);

    await model.fetchData({ page: 0 });
    expect(queryHistory).toHaveBeenCalledTimes(2);
  });
});
