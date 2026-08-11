/**
 * sqliteHistoryPanelState.test.ts
 * Pure-function verification of the SQLite history panel reducer.
 *
 * The reducer (sqliteHistoryPanelState.ts) is the DOM-independent state seam
 * of the panel: every transition — search, pagination, tag filter, load
 * lifecycle, selection, star/delete — is expressed here and verified in a
 * plain Node test environment without jsdom or the panel closure.
 *
 * Contracts asserted below are the ones documented in the module header:
 *   - negative page numbers are clamped to 0,
 *   - an emptied tag filter clears fallback-related state (and the search
 *     query when it was installed by a tag fallback),
 *   - a failed query becomes an error state, never a successful empty result,
 *   - loadSuccess applies tagFallback results and clears selection.
 */
import { describe, it, expect } from 'vitest';
import {
  createInitialHistoryState,
  historyStateReducer,
  type SqliteHistoryState,
} from '../sqliteHistoryPanelState.js';
import type { BrowsingLogEntry } from '../sqliteHistoryQuery.js';

function makeEntry(id: number, overrides: Partial<BrowsingLogEntry> = {}): BrowsingLogEntry {
  return {
    id,
    url: `https://example.com/${id}`,
    title: `Example ${id}`,
    created_at: 1700000000000 + id,
    ...overrides,
  };
}

function makeState(overrides: Partial<SqliteHistoryState> = {}): SqliteHistoryState {
  return { ...createInitialHistoryState(), ...overrides };
}

describe('createInitialHistoryState', () => {
  it('returns a neutral state with an empty selection set', () => {
    const state = createInitialHistoryState();
    expect(state).toEqual({
      entries: [],
      total: 0,
      currentPage: 0,
      searchQuery: '',
      selectedDate: null,
      loading: false,
      error: null,
      fallbackMode: false,
      selectedIds: new Set(),
      activeTagFilter: null,
      pendingTagFallback: null,
    });
  });
});

describe('historyStateReducer — load lifecycle', () => {
  it('loadStart sets loading and clears a previous error', () => {
    const state = makeState({ error: 'old', loading: false });
    const next = historyStateReducer(state, { type: 'loadStart' });
    expect(next.loading).toBe(true);
    expect(next.error).toBeNull();
  });

  it('loadSuccess replaces entries/total, clears selection and error', () => {
    const state = makeState({
      entries: [makeEntry(9)],
      total: 100,
      selectedIds: new Set([1, 2]),
      error: 'stale',
      loading: true,
    });
    const next = historyStateReducer(state, {
      type: 'loadSuccess',
      data: { rows: [makeEntry(1), makeEntry(2)], total: 2 },
    });
    expect(next.entries.map(e => e.id)).toEqual([1, 2]);
    expect(next.total).toBe(2);
    expect(next.selectedIds.size).toBe(0);
    expect(next.error).toBeNull();
    expect(next.loading).toBe(false);
  });

  it('loadSuccess keeps the search query when no tagFallback is reported', () => {
    const state = makeState({
      searchQuery: 'keep-me',
      pendingTagFallback: { tag: 'AI', fallbackTo: 'AI', matched: 3 },
    });
    const next = historyStateReducer(state, {
      type: 'loadSuccess',
      data: { rows: [], total: 0 },
    });
    expect(next.searchQuery).toBe('keep-me');
    expect(next.pendingTagFallback).toEqual({ tag: 'AI', fallbackTo: 'AI', matched: 3 });
  });

  it('loadSuccess syncs the search box to the tagFallback term', () => {
    const state = makeState({ searchQuery: 'old' });
    const next = historyStateReducer(state, {
      type: 'loadSuccess',
      data: {
        rows: [makeEntry(1)],
        total: 54,
        tagFallback: {
          searchQuery: 'AI',
          pendingTagFallback: { tag: '#AI', fallbackTo: 'AI', matched: 54 },
        },
      },
    });
    expect(next.searchQuery).toBe('AI');
    expect(next.pendingTagFallback).toEqual({ tag: '#AI', fallbackTo: 'AI', matched: 54 });
  });

  it('loadSuccess preserves the search box when tagFallback.searchQuery is unset', () => {
    const state = makeState({ searchQuery: 'retained' });
    const next = historyStateReducer(state, {
      type: 'loadSuccess',
      data: {
        rows: [makeEntry(1)],
        total: 1,
        tagFallback: { pendingTagFallback: null },
      },
    });
    expect(next.searchQuery).toBe('retained');
    expect(next.pendingTagFallback).toBeNull();
  });

  it('loadFailure is an error state, never a successful empty result', () => {
    const state = makeState({ entries: [makeEntry(1)], total: 5, loading: true, selectedIds: new Set([1]) });
    const next = historyStateReducer(state, { type: 'loadFailure', error: 'boom' });
    expect(next.error).toBe('boom');
    expect(next.entries).toEqual([]);
    expect(next.total).toBe(0);
    expect(next.loading).toBe(false);
  });
});

describe('historyStateReducer — search and date filters', () => {
  it('search sets the query, resets to page 0 and clears a pending tag fallback', () => {
    const state = makeState({
      currentPage: 3,
      searchQuery: 'before',
      pendingTagFallback: { tag: 'AI', fallbackTo: 'AI', matched: 1 },
    });
    const next = historyStateReducer(state, { type: 'search', query: 'new term' });
    expect(next.searchQuery).toBe('new term');
    expect(next.currentPage).toBe(0);
    expect(next.pendingTagFallback).toBeNull();
  });

  it('dateSelect clears search/fallback and resets the page', () => {
    const state = makeState({
      selectedDate: null,
      searchQuery: 'q',
      pendingTagFallback: { tag: 'AI', fallbackTo: 'AI', matched: 1 },
      currentPage: 2,
    });
    const next = historyStateReducer(state, { type: 'dateSelect', date: '2026-08-01' });
    expect(next.selectedDate).toBe('2026-08-01');
    expect(next.searchQuery).toBe('');
    expect(next.pendingTagFallback).toBeNull();
    expect(next.currentPage).toBe(0);
  });

  it('rangeSelect clears the date, search and fallback', () => {
    const state = makeState({
      selectedDate: '2026-08-01',
      searchQuery: 'q',
      pendingTagFallback: { tag: 'AI', fallbackTo: 'AI', matched: 1 },
      currentPage: 2,
    });
    const next = historyStateReducer(state, { type: 'rangeSelect' });
    expect(next.selectedDate).toBeNull();
    expect(next.searchQuery).toBe('');
    expect(next.pendingTagFallback).toBeNull();
    expect(next.currentPage).toBe(0);
  });

  it('clearFilters resets every filter at once', () => {
    const state = makeState({
      searchQuery: 'q',
      selectedDate: '2026-08-01',
      activeTagFilter: 'AI',
      pendingTagFallback: { tag: 'AI', fallbackTo: 'AI', matched: 1 },
      currentPage: 4,
    });
    const next = historyStateReducer(state, { type: 'clearFilters' });
    expect(next.searchQuery).toBe('');
    expect(next.selectedDate).toBeNull();
    expect(next.activeTagFilter).toBeNull();
    expect(next.pendingTagFallback).toBeNull();
    expect(next.currentPage).toBe(0);
  });
});

describe('historyStateReducer — tag filter', () => {
  it('tagFilterClick activates a tag and resets the page', () => {
    const state = makeState({ activeTagFilter: null, currentPage: 2 });
    const next = historyStateReducer(state, { type: 'tagFilterClick', tag: 'AI' });
    expect(next.activeTagFilter).toBe('AI');
    expect(next.currentPage).toBe(0);
  });

  it('tagFilterClick toggling the active tag off clears the fallback and its search query', () => {
    const state = makeState({
      activeTagFilter: 'AI',
      searchQuery: 'AI',
      pendingTagFallback: { tag: 'AI', fallbackTo: 'AI', matched: 5 },
      currentPage: 1,
    });
    const next = historyStateReducer(state, { type: 'tagFilterClick', tag: 'AI' });
    expect(next.activeTagFilter).toBeNull();
    expect(next.pendingTagFallback).toBeNull();
    // The search box value came from the fallback: it must be cleared too.
    expect(next.searchQuery).toBe('');
    expect(next.currentPage).toBe(0);
  });

  it('tagFilterClick toggling off without a fallback keeps the manual search query', () => {
    const state = makeState({ activeTagFilter: 'AI', searchQuery: 'manual', pendingTagFallback: null });
    const next = historyStateReducer(state, { type: 'tagFilterClick', tag: 'AI' });
    expect(next.activeTagFilter).toBeNull();
    expect(next.searchQuery).toBe('manual');
  });

  it('clearTagFilter clears the fallback-installed search query', () => {
    const state = makeState({
      activeTagFilter: 'AI',
      searchQuery: 'AI',
      pendingTagFallback: { tag: 'AI', fallbackTo: 'AI', matched: 5 },
      currentPage: 3,
    });
    const next = historyStateReducer(state, { type: 'clearTagFilter' });
    expect(next.activeTagFilter).toBeNull();
    expect(next.pendingTagFallback).toBeNull();
    expect(next.searchQuery).toBe('');
    expect(next.currentPage).toBe(0);
  });

  it('clearTagFilter with an empty fallback search keeps the search empty', () => {
    const state = makeState({
      activeTagFilter: 'AI',
      searchQuery: '',
      pendingTagFallback: { tag: 'AI', fallbackTo: 'AI', matched: 0 },
    });
    const next = historyStateReducer(state, { type: 'clearTagFilter' });
    expect(next.searchQuery).toBe('');
  });

  it('clearTagFilter without a pending fallback keeps the manual search query', () => {
    const state = makeState({ activeTagFilter: 'AI', searchQuery: 'manual', pendingTagFallback: null });
    const next = historyStateReducer(state, { type: 'clearTagFilter' });
    expect(next.activeTagFilter).toBeNull();
    expect(next.searchQuery).toBe('manual');
  });

  it('tagInitiated installs the tag filter, search box and page 0', () => {
    const state = makeState({
      activeTagFilter: null,
      searchQuery: '',
      pendingTagFallback: { tag: 'old', fallbackTo: 'old', matched: 1 },
      currentPage: 2,
    });
    const next = historyStateReducer(state, { type: 'tagInitiated', tag: '教育' });
    expect(next.activeTagFilter).toBe('教育');
    expect(next.searchQuery).toBe('教育');
    expect(next.pendingTagFallback).toBeNull();
    expect(next.currentPage).toBe(0);
  });

  it('domainSearchInitiated sets the query and page without touching the tag filter', () => {
    const state = makeState({
      searchQuery: '',
      activeTagFilter: 'AI',
      pendingTagFallback: { tag: 'AI', fallbackTo: 'AI', matched: 1 },
      currentPage: 2,
    });
    const next = historyStateReducer(state, { type: 'domainSearchInitiated', query: 'example.com' });
    expect(next.searchQuery).toBe('example.com');
    expect(next.currentPage).toBe(0);
    expect(next.activeTagFilter).toBe('AI');
    expect(next.pendingTagFallback).not.toBeNull();
  });
});

describe('historyStateReducer — pagination', () => {
  it('pageChange clamps negative pages to 0', () => {
    const state = makeState({ currentPage: 0 });
    expect(historyStateReducer(state, { type: 'pageChange', page: -1 }).currentPage).toBe(0);
    expect(historyStateReducer(state, { type: 'pageChange', page: -42 }).currentPage).toBe(0);
  });

  it('pageChange keeps zero and positive pages', () => {
    const state = makeState({ currentPage: 0 });
    expect(historyStateReducer(state, { type: 'pageChange', page: 0 }).currentPage).toBe(0);
    expect(historyStateReducer(state, { type: 'pageChange', page: 7 }).currentPage).toBe(7);
  });
});

describe('historyStateReducer — star/delete operations', () => {
  it('toggleStarSuccess flips is_starred on the matching entry and clears the error', () => {
    const state = makeState({
      entries: [makeEntry(1, { is_starred: 0 }), makeEntry(2, { is_starred: 1 })],
      error: 'stale',
    });
    const next = historyStateReducer(state, { type: 'toggleStarSuccess', id: 1, starred: true });
    expect(next.entries[0]!.is_starred).toBe(1);
    expect(next.entries[1]!.is_starred).toBe(1);
    expect(next.error).toBeNull();
  });

  it('toggleStarSuccess unstarring sets is_starred to 0', () => {
    const state = makeState({ entries: [makeEntry(1, { is_starred: 1 })] });
    const next = historyStateReducer(state, { type: 'toggleStarSuccess', id: 1, starred: false });
    expect(next.entries[0]!.is_starred).toBe(0);
  });

  it('toggleStarSuccess leaves unknown ids untouched', () => {
    const state = makeState({ entries: [makeEntry(1, { is_starred: 0 })] });
    const next = historyStateReducer(state, { type: 'toggleStarSuccess', id: 999, starred: true });
    expect(next.entries[0]!.is_starred).toBe(0);
  });

  it('deleteSuccess removes the entry, decrements total and clears selection of that id', () => {
    const state = makeState({
      entries: [makeEntry(1), makeEntry(2), makeEntry(3)],
      total: 10,
      selectedIds: new Set([2, 99]),
      error: 'stale',
    });
    const next = historyStateReducer(state, { type: 'deleteSuccess', id: 2 });
    expect(next.entries.map(e => e.id)).toEqual([1, 3]);
    expect(next.total).toBe(9);
    expect(next.selectedIds.has(2)).toBe(false);
    expect(next.selectedIds.has(99)).toBe(true);
    expect(next.error).toBeNull();
  });

  it('deleteSuccess never drops total below 0', () => {
    const state = makeState({ entries: [], total: 0 });
    const next = historyStateReducer(state, { type: 'deleteSuccess', id: 5 });
    expect(next.total).toBe(0);
  });

  it('operationError keeps the current entries (a failed write claims no change)', () => {
    const state = makeState({ entries: [makeEntry(1)], total: 1, error: null });
    const next = historyStateReducer(state, { type: 'operationError', error: 'write failed' });
    expect(next.error).toBe('write failed');
    expect(next.entries).toHaveLength(1);
    expect(next.total).toBe(1);
  });
});

describe('historyStateReducer — selection', () => {
  it('selectionChange selects and deselects ids without mutating the previous set', () => {
    const state = makeState({ selectedIds: new Set([1]) });
    const next = historyStateReducer(state, { type: 'selectionChange', id: 2, selected: true });
    expect([...next.selectedIds].sort()).toEqual([1, 2]);
    expect(state.selectedIds.has(2)).toBe(false);

    const afterDeselect = historyStateReducer(next, { type: 'selectionChange', id: 1, selected: false });
    expect([...afterDeselect.selectedIds]).toEqual([2]);
    expect(next.selectedIds.has(1)).toBe(true);
  });

  it('selectAll checked selects every rendered entry', () => {
    const state = makeState({ entries: [makeEntry(1), makeEntry(2)], selectedIds: new Set() });
    const next = historyStateReducer(state, { type: 'selectAll', checked: true });
    expect([...next.selectedIds].sort()).toEqual([1, 2]);
  });

  it('selectAll unchecked clears the selection', () => {
    const state = makeState({ entries: [makeEntry(1), makeEntry(2)], selectedIds: new Set([1, 2]) });
    const next = historyStateReducer(state, { type: 'selectAll', checked: false });
    expect(next.selectedIds.size).toBe(0);
  });

  it('clearSelection empties the selection', () => {
    const state = makeState({ selectedIds: new Set([1, 2, 3]) });
    const next = historyStateReducer(state, { type: 'clearSelection' });
    expect(next.selectedIds.size).toBe(0);
  });

  it('appendSuccess clears the selection', () => {
    const state = makeState({ selectedIds: new Set([1, 2]) });
    const next = historyStateReducer(state, { type: 'appendSuccess' });
    expect(next.selectedIds.size).toBe(0);
  });

  it('loadSuccess clears a full selection (paged navigation deselects)', () => {
    const state = makeState({
      entries: [makeEntry(1)],
      selectedIds: new Set([1, 5, 7]),
    });
    const next = historyStateReducer(state, {
      type: 'loadSuccess',
      data: { rows: [makeEntry(2)], total: 1 },
    });
    expect(next.selectedIds.size).toBe(0);
  });
});

describe('historyStateReducer — fallback mode and state identity', () => {
  it('setFallbackMode marks the panel as running in storage fallback', () => {
    const state = makeState({ fallbackMode: false });
    const next = historyStateReducer(state, { type: 'setFallbackMode' });
    expect(next.fallbackMode).toBe(true);
  });

  it('reducer returns a new state object for every transition', () => {
    const state = makeState();
    for (const action of [
      { type: 'loadStart' },
      { type: 'search', query: 'x' },
      { type: 'pageChange', page: 1 },
    ] as const) {
      expect(historyStateReducer(state, action)).not.toBe(state);
    }
  });
});
