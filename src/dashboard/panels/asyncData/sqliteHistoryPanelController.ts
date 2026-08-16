/**
 * sqliteHistoryPanelController.ts
 * DOM-independent orchestration for the SQLite history panel: owns
 * SqliteHistoryState, drives queryHistory through historyStateReducer, and
 * guards against out-of-order responses (requestGeneration) and the
 * onActivate/loadData init race (pendingInit).
 *
 * The panel (sqliteHistoryPanel.ts) owns all DOM rendering; it subscribes via
 * onStateChange and reads state through getState(). No DOM API is imported
 * here — that is what makes fetchData/pendingInit testable without jsdom.
 */

import {
  queryHistory,
  dateRangeFromSelectedDate,
} from './sqliteHistoryQuery.js';
import type { UnifiedHistoryQueryResult } from './sqliteHistoryQuery.js';
import {
  getSqliteStatus,
  toggleStar,
  deleteLog,
  appendToLogs,
} from '../../dashboardSqliteService.js';
import { isServiceError } from '../../dashboardSqliteService.js';
import { removeSavedUrl } from '../../../utils/storageUrls.js';
import { retryWithExponentialBackoff } from '../../utils/retry.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import {
  createInitialHistoryState,
  historyStateReducer,
  type SqliteHistoryState,
} from './sqliteHistoryPanelState.js';

const PAGE_SIZE = 20;

const HISTORY_SORT_STORAGE_KEY = 'history_sort_preference';

async function loadPersistedSort(): Promise<{ sortBy: SqliteHistoryState['sortBy']; sortDir: SqliteHistoryState['sortDir'] } | null> {
  try {
    const items = await chrome.storage.local.get(HISTORY_SORT_STORAGE_KEY);
    const raw = items[HISTORY_SORT_STORAGE_KEY];
    if (typeof raw !== 'string') return null;
    const parsed = JSON.parse(raw) as { sortBy?: string; sortDir?: string };
    if (parsed.sortBy !== 'created_at' && parsed.sortBy !== 'relevance') return null;
    if (parsed.sortDir !== 'ASC' && parsed.sortDir !== 'DESC') return null;
    return { sortBy: parsed.sortBy, sortDir: parsed.sortDir };
  } catch {
    return null;
  }
}

async function persistSort(sortBy: SqliteHistoryState['sortBy'], sortDir: SqliteHistoryState['sortDir']): Promise<void> {
  try {
    await chrome.storage.local.set({ [HISTORY_SORT_STORAGE_KEY]: JSON.stringify({ sortBy, sortDir }) });
  } catch (error) {
    console.error('Failed to persist history sort preference:', error);
  }
}

export interface FetchDataOptions {
  limit?: number;
  since?: number;
  until?: number;
  search?: string;
  page?: number;
  tagFilter?: string;
  tagInitiated?: boolean;
}

export interface SqliteHistoryControllerDeps {
  /** Injectable for testing; defaults to the real queryHistory. */
  queryHistory?: typeof queryHistory;
  /** Injectable for testing; defaults to the real getSqliteStatus. */
  getSqliteStatus?: typeof getSqliteStatus;
  /** Called after every state transition; the panel re-renders from getState(). */
  onStateChange: () => void;
}

/** Outcome of appendSelectedToObsidian, for the panel to render as an OS notification. */
export type AppendResult =
  | { success: true; appendedCount: number }
  | { success: false; error: string };

export interface SqliteHistoryController {
  getState(): Readonly<SqliteHistoryState>;
  dateRangeFromSelected(): { since?: number; until?: number };
  fetchData(options?: FetchDataOptions): Promise<void>;
  reloadCurrent(): void;
  checkFallbackStatus(): Promise<void>;
  retryInitialLoad(fetchOpts?: FetchDataOptions): Promise<void>;
  /** Consume pending init parameters set by activateWithTag/activateWithDomain. */
  consumePendingInit(): FetchDataOptions | null;
  activateWithTag(tag: string): void;
  activateWithDomain(query: string): void;
  loadPersistedSortIntoState(): Promise<void>;
  bumpGenerationOnUnmount(): void;

  // Write handlers (段階B)
  toggleStar(id: number): Promise<void>;
  /** Caller (panel) must confirm with the user before calling this. */
  deleteEntry(id: number): Promise<void>;
  appendSelectedToObsidian(): Promise<AppendResult | null>;
  search(query: string): void;
  selectDate(dateStr: string): Promise<void>;
  changeSort(sortBy: SqliteHistoryState['sortBy'], sortDir: SqliteHistoryState['sortDir']): Promise<void>;
  filterByTag(tag: string): void;
  clearTagFilter(): void;
  selectDateRange(since: number, until: number): void;
  clearAllFilters(): void;
  changePage(page: number): void;

  // Selection (段階C-1/C-2: reducer 経由に統一)
  selectEntry(id: number, selected: boolean): void;
  selectAllEntries(checked: boolean): void;
  clearEntrySelection(): void;
}

export function createSqliteHistoryController(
  deps: SqliteHistoryControllerDeps,
): SqliteHistoryController {
  const runQueryHistory = deps.queryHistory ?? queryHistory;
  const runGetSqliteStatus = deps.getSqliteStatus ?? getSqliteStatus;

  let state = createInitialHistoryState();
  let requestGeneration = 0;
  /**
   * Pending init parameters set by activateWithTag/activateWithDomain before
   * loadData runs. Used to preserve searchTag/searchDomain across the
   * loadData lifecycle.
   */
  let pendingInit: Record<string, unknown> | null = null;

  function dispatch(action: Parameters<typeof historyStateReducer>[1]): void {
    state = historyStateReducer(state, action);
  }

  function dateRangeFromSelected(): { since?: number; until?: number } {
    return dateRangeFromSelectedDate(state.selectedDate);
  }

  async function fetchData(options: FetchDataOptions = {}): Promise<void> {
    const generation = ++requestGeneration;
    dispatch({ type: 'loadStart' });
    deps.onStateChange();

    try {
      const page = Math.max(0, options.page ?? state.currentPage);
      const limit = PAGE_SIZE;
      const offset = page * limit;

      const activeTagFilter = options.tagFilter !== undefined ? options.tagFilter : state.activeTagFilter;

      // All storage knowledge — SQLite paging/search plus legacy
      // chrome.storage enrichment — lives in the unified history query module.
      const result: UnifiedHistoryQueryResult = await runQueryHistory({
        search: options.search,
        since: options.since,
        until: options.until,
        limit,
        offset,
        tagFilter: activeTagFilter || undefined,
        tagInitiated: options.tagInitiated,
        sortBy: state.sortBy,
        sortDir: state.sortDir,
      });

      if (generation !== requestGeneration) return;

      if (isServiceError(result)) {
        dispatch({ type: 'loadFailure', error: 'historyLoadError' });
      } else {
        dispatch({ type: 'loadSuccess', data: result.data });
      }
    } catch (err) {
      if (generation !== requestGeneration) return;
      dispatch({ type: 'loadFailure', error: `Error: ${errorMessage(err)}` });
    } finally {
      if (generation === requestGeneration) {
        state = { ...state, loading: false };
        deps.onStateChange();
      }
    }
  }

  function reloadCurrent(): void {
    if (state.searchQuery.trim()) {
      void fetchData({ search: state.searchQuery, page: state.currentPage });
    } else {
      void fetchData({ ...dateRangeFromSelected(), page: state.currentPage });
    }
  }

  async function checkFallbackStatus(): Promise<void> {
    try {
      const status = await runGetSqliteStatus();
      if (status?.fallback) {
        dispatch({ type: 'setFallbackMode' });
        deps.onStateChange();
      }
    } catch {
      // Ignore
    }
  }

  async function retryInitialLoad(
    fetchOpts: FetchDataOptions = { limit: PAGE_SIZE },
  ): Promise<void> {
    await retryWithExponentialBackoff<boolean>(
      async () => {
        await fetchData(fetchOpts);
        return state.error ? null : true;
      },
      { label: 'sqliteHistory', maxAttempts: 4 }
    );
    deps.onStateChange();
  }

  function consumePendingInit(): FetchDataOptions | null {
    const init = pendingInit;
    pendingInit = null;
    if (!init) return null;

    if (init.searchTag) {
      return { tagFilter: (init.searchTag as string) || undefined, tagInitiated: true, limit: PAGE_SIZE };
    }
    if (init.searchDomain) {
      const q = (init.searchDomain as string).trim();
      if (q) return { search: q, limit: PAGE_SIZE };
    }
    return null;
  }

  function activateWithTag(tag: string): void {
    pendingInit = { searchTag: tag };
    dispatch({ type: 'tagInitiated', tag });
    void fetchData({ page: 0, tagFilter: state.activeTagFilter || undefined, tagInitiated: true });
  }

  function activateWithDomain(query: string): void {
    pendingInit = { searchDomain: query };
    dispatch({ type: 'domainSearchInitiated', query });
    if (state.searchQuery.trim()) {
      void fetchData({ search: state.searchQuery.trim() });
    }
  }

  async function loadPersistedSortIntoState(): Promise<void> {
    const persistedSort = await loadPersistedSort();
    if (persistedSort) {
      state = { ...state, sortBy: persistedSort.sortBy, sortDir: persistedSort.sortDir };
    }
  }

  function bumpGenerationOnUnmount(): void {
    requestGeneration += 1;
  }

  async function toggleStarImpl(id: number): Promise<void> {
    const result = await toggleStar(id);
    if ('error' in result) {
      // Without this the click looked ignored: a failed toggle left the star
      // unchanged and showed nothing at all (PBI-21).
      dispatch({ type: 'operationError', error: result.error });
      deps.onStateChange();
      return;
    }
    const entry = state.entries.find(e => e.id === id);
    if (entry) {
      dispatch({ type: 'toggleStarSuccess', id, starred: result.data.is_starred === 1 });
    }
    deps.onStateChange();
  }

  async function deleteEntry(id: number): Promise<void> {
    const entry = state.entries.find((candidate) => candidate.id === id);
    const result = await deleteLog(id);
    if ('error' in result) {
      // The entry stays in the list — removing it would claim a delete that
      // did not happen.
      dispatch({ type: 'operationError', error: result.error });
      deps.onStateChange();
      return;
    }
    // Keep the legacy source in sync so startup migration cannot recreate it.
    if (entry) {
      try {
        await removeSavedUrl(entry.url);
      } catch (error) {
        console.error('Failed to remove legacy history entry:', error);
      }
    }
    dispatch({ type: 'deleteSuccess', id });
    deps.onStateChange();
  }

  async function appendSelectedToObsidian(): Promise<AppendResult | null> {
    if (state.selectedIds.size === 0) return null;

    const ids = Array.from(state.selectedIds);
    const result = await appendToLogs(ids);

    if ('data' in result) {
      state.selectedIds.clear();
      deps.onStateChange();
      return { success: true, appendedCount: ids.length };
    }

    // "Obsidian not configured" used to be the only failure message shown,
    // covering both that case and every other reason alike; the reason from
    // the response is now available and worth showing instead of guessing.
    return { success: false, error: result.error };
  }

  function search(query: string): void {
    dispatch({ type: 'search', query });
    if (query.trim()) {
      void fetchData({ search: query.trim() });
    } else {
      void fetchData({ page: 0 });
    }
  }

  async function selectDate(dateStr: string): Promise<void> {
    dispatch({ type: 'dateSelect', date: dateStr });

    const date = new Date(dateStr + 'T00:00:00');
    const since = date.getTime();
    const until = date.getTime() + 86400000 - 1;

    await fetchData({ since, until });
  }

  async function changeSort(sortBy: SqliteHistoryState['sortBy'], sortDir: SqliteHistoryState['sortDir']): Promise<void> {
    dispatch({ type: 'sortChange', sortBy, sortDir });
    void persistSort(sortBy, sortDir);
    if (state.searchQuery.trim()) {
      await fetchData({ search: state.searchQuery, page: 0 });
    } else {
      await fetchData({ ...dateRangeFromSelected(), page: 0 });
    }
  }

  function filterByTag(tag: string): void {
    dispatch({ type: 'tagFilterClick', tag });
    void fetchData({ tagFilter: state.activeTagFilter || undefined, ...dateRangeFromSelected() });
  }

  function clearTagFilter(): void {
    const hadFallback = state.pendingTagFallback !== null;
    dispatch({ type: 'clearTagFilter' });
    if (hadFallback && state.searchQuery) dispatch({ type: 'search', query: '' });
    void fetchData({ page: 0, ...dateRangeFromSelected() });
  }

  function selectDateRange(since: number, until: number): void {
    dispatch({ type: 'rangeSelect' });
    void fetchData({ since, until });
  }

  function clearAllFilters(): void {
    dispatch({ type: 'clearFilters' });
    void fetchData();
  }

  function changePage(page: number): void {
    dispatch({ type: 'pageChange', page });
    reloadCurrent();
  }

  function selectEntry(id: number, selected: boolean): void {
    dispatch({ type: 'selectionChange', id, selected });
    deps.onStateChange();
  }

  function selectAllEntries(checked: boolean): void {
    dispatch({ type: 'selectAll', checked });
    deps.onStateChange();
  }

  function clearEntrySelection(): void {
    dispatch({ type: 'clearSelection' });
    deps.onStateChange();
  }

  return {
    getState: () => state,
    dateRangeFromSelected,
    fetchData,
    reloadCurrent,
    checkFallbackStatus,
    retryInitialLoad,
    consumePendingInit,
    activateWithTag,
    activateWithDomain,
    loadPersistedSortIntoState,
    bumpGenerationOnUnmount,
    toggleStar: toggleStarImpl,
    deleteEntry,
    appendSelectedToObsidian,
    search,
    selectDate,
    changeSort,
    filterByTag,
    clearTagFilter,
    selectDateRange,
    clearAllFilters,
    changePage,
    selectEntry,
    selectAllEntries,
    clearEntrySelection,
  };
}

export { persistSort };
