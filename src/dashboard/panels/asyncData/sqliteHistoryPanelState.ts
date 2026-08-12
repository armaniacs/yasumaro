/**
 * sqliteHistoryPanelState.ts
 * DOM-independent state seam for the SQLite history panel.
 *
 * Every state transition the panel performs — search, pagination, tag filter,
 * load lifecycle, selection, star/delete results — is expressed as a reducer
 * action here. The reducer is pure: it maps the previous state and an action to
 * the next state without touching the DOM, so transitions can be verified in a
 * plain Node test environment without the panel closure or jsdom.
 *
 * The rules below deliberately preserve the panel's existing behavior:
 *   - negative page numbers are clamped to 0,
 *   - an emptied tag filter clears the filter-related state (fallback notice,
 *     and the search query when it was installed by a tag fallback),
 *   - a failed query becomes an error state, never a successful empty result,
 *   - the unified query module (child PBI 2) is the only source of rows; this
 *     module never reaches into storage schemas.
 */

import type { BrowsingLogEntry } from './sqliteHistoryQuery.js';
import type { UnifiedHistoryQueryData } from './sqliteHistoryQuery.js';

export interface SqliteHistoryState {
  entries: BrowsingLogEntry[];
  total: number;
  currentPage: number;
  searchQuery: string;
  selectedDate: string | null;
  loading: boolean;
  error: string | null;
  fallbackMode: boolean;
  selectedIds: Set<number>;
  activeTagFilter: string | null;
  /**
   * Set when a tag-initiated navigation (Tag Cluster) produced zero tag
   * matches and we fell back to a full-text search for the term. UI shows a
   * notice while this is non-null.
   */
  pendingTagFallback: { tag: string; fallbackTo: string; matched: number } | null;
}

export function createInitialHistoryState(): SqliteHistoryState {
  return {
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
  };
}

export type SqliteHistoryAction =
  | { type: 'loadStart' }
  | { type: 'loadSuccess'; data: UnifiedHistoryQueryData }
  | { type: 'loadFailure'; error: string }
  | { type: 'search'; query: string }
  | { type: 'dateSelect'; date: string }
  | { type: 'rangeSelect' }
  | { type: 'clearFilters' }
  | { type: 'tagFilterClick'; tag: string }
  | { type: 'clearTagFilter' }
  | { type: 'pageChange'; page: number }
  | { type: 'tagInitiated'; tag: string }
  | { type: 'domainSearchInitiated'; query: string }
  | { type: 'toggleStarSuccess'; id: number; starred: boolean }
  | { type: 'deleteSuccess'; id: number }
  | { type: 'operationError'; error: string }
  | { type: 'selectionChange'; id: number; selected: boolean }
  | { type: 'selectAll'; checked: boolean }
  | { type: 'clearSelection' }
  | { type: 'appendSuccess' }
  | { type: 'setFallbackMode' };

function clearTagFilterState(
  state: SqliteHistoryState,
): SqliteHistoryState {
  // The search box value may have come from a tag fallback; when it did,
  // clearing the filter must clear the search too, otherwise a stale
  // full-text query stays behind.
  const hadFallback = state.pendingTagFallback !== null;
  return {
    ...state,
    activeTagFilter: null,
    pendingTagFallback: null,
    currentPage: 0,
    searchQuery: hadFallback && state.searchQuery ? '' : state.searchQuery,
  };
}

export function historyStateReducer(
  state: SqliteHistoryState,
  action: SqliteHistoryAction,
): SqliteHistoryState {
  switch (action.type) {
    case 'loadStart':
      return { ...state, loading: true, error: null };

    case 'loadSuccess': {
      const data = action.data;
      let searchQuery = state.searchQuery;
      let pendingTagFallback = state.pendingTagFallback;
      // A tag→full-text fallback re-targets the search box and may surface a
      // notice; the module reports the outcome so the state stays in sync.
      if (data.tagFallback) {
        if (data.tagFallback.searchQuery !== undefined) {
          searchQuery = data.tagFallback.searchQuery;
        }
        pendingTagFallback = data.tagFallback.pendingTagFallback;
      }
      return {
        ...state,
        entries: data.rows,
        total: data.total,
        selectedIds: new Set(),
        searchQuery,
        pendingTagFallback,
        loading: false,
        error: null,
      };
    }

    case 'loadFailure':
      // A failed query is an error state, never a successful empty result:
      // the error is kept so the UI can show it instead of the empty state.
      return { ...state, error: action.error, entries: [], total: 0, loading: false };

    case 'search':
      return { ...state, searchQuery: action.query, currentPage: 0, pendingTagFallback: null };

    case 'dateSelect':
      return {
        ...state,
        selectedDate: action.date,
        searchQuery: '',
        pendingTagFallback: null,
        currentPage: 0,
      };

    case 'rangeSelect':
      return { ...state, selectedDate: null, searchQuery: '', pendingTagFallback: null, currentPage: 0 };

    case 'clearFilters':
      return { ...state, searchQuery: '', selectedDate: null, activeTagFilter: null, pendingTagFallback: null, currentPage: 0 };

    case 'tagFilterClick': {
      const nextTag = state.activeTagFilter === action.tag ? null : action.tag;
      // Toggling the active tag off empties the filter; treat it like an
      // explicit clear so no stale fallback or search text survives.
      if (nextTag === null) {
        return clearTagFilterState(state);
      }
      return { ...state, activeTagFilter: nextTag, currentPage: 0 };
    }

    case 'clearTagFilter':
      return clearTagFilterState(state);

    case 'pageChange':
      // The pagination controls never produce negative pages, but a caller
      // can pass one; clamp instead of deriving a nonsensical offset.
      return { ...state, currentPage: Math.max(0, action.page) };

    case 'tagInitiated':
      return {
        ...state,
        activeTagFilter: action.tag,
        currentPage: 0,
        pendingTagFallback: null,
        searchQuery: action.tag,
      };

    case 'domainSearchInitiated':
      return { ...state, searchQuery: action.query, currentPage: 0 };

    case 'toggleStarSuccess':
      return {
        ...state,
        error: null,
        entries: state.entries.map(entry =>
          entry.id === action.id ? { ...entry, is_starred: action.starred ? 1 : 0 } : entry,
        ),
      };

    case 'deleteSuccess': {
      const selectedIds = new Set(state.selectedIds);
      selectedIds.delete(action.id);
      return {
        ...state,
        entries: state.entries.filter(entry => entry.id !== action.id),
        total: Math.max(0, state.total - 1),
        selectedIds,
        error: null,
      };
    }

    case 'operationError':
      // Keep the current entries: a failed star/delete must not claim a
      // change that did not happen.
      return { ...state, error: action.error };

    case 'selectionChange': {
      const selectedIds = new Set(state.selectedIds);
      if (action.selected) {
        selectedIds.add(action.id);
      } else {
        selectedIds.delete(action.id);
      }
      return { ...state, selectedIds };
    }

    case 'selectAll':
      return {
        ...state,
        selectedIds: action.checked ? new Set(state.entries.map(entry => entry.id)) : new Set(),
      };

    case 'clearSelection':
      return { ...state, selectedIds: new Set() };

    case 'appendSuccess':
      return { ...state, selectedIds: new Set() };

    case 'setFallbackMode':
      return { ...state, fallbackMode: true };
  }
}
