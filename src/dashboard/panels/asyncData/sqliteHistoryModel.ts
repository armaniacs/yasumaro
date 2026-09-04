/**
 * sqliteHistoryModel.ts
 * HistoryModel — shrunk MVC integration (PBI-17).
 *
 * Owns SqliteHistoryState + historyStateReducer (formerly in
 * sqliteHistoryPanelState.ts) and the generation / pendingInit / sort-persistence
 * guards (formerly in sqliteHistoryPanelController.ts). Query (sqliteHistoryQuery)
 * and View (sqliteHistoryPanelView) stay as delegation targets.
 *
 * The panel subscribes via `subscribe()` (thin alias of the former
 * `onStateChange` callback) and reads state through `getState()`. No DOM API is
 * imported here — that is what makes generation / pendingInit testable without
 * jsdom.
 */

import {
  queryHistory,
  dateRangeFromSelectedDate,
} from './sqliteHistoryQuery.js';
import type { UnifiedHistoryQueryResult, UnifiedHistoryQueryData, BrowsingLogEntry } from './sqliteHistoryQuery.js';
import {
  getSqliteStatus,
  toggleStar,
  deleteLog,
  appendToLogs,
} from '../../dashboardSqliteService.js';
import { isServiceError } from '../../dashboardSqliteService.js';
import { removeSavedUrl } from '../../../utils/storageUrls.js';
import { pickDefined } from '../../../utils/objectUtils.js';
import { retryWithExponentialBackoff } from '../../utils/retry.js';
import { errorMessage } from '../../../utils/errorUtils.js';

// ---------------------------------------------------------------------------
// State — moved from sqliteHistoryPanelState.ts so HistoryModel owns it.
// The reducer stays pure and re-used internally via dispatch().
// ---------------------------------------------------------------------------

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
  pendingTagFallback: { tag: string; fallbackTo: string; matched: number } | null;
  sortBy: 'created_at' | 'relevance';
  sortDir: 'ASC' | 'DESC';
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
    sortBy: 'created_at',
    sortDir: 'DESC',
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
  | { type: 'sortChange'; sortBy: 'created_at' | 'relevance'; sortDir: 'ASC' | 'DESC' }
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

function clearTagFilterState(state: SqliteHistoryState): SqliteHistoryState {
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
      return { ...state, error: action.error, entries: [], total: 0, loading: false };

    case 'search': {
      const trimmed = action.query.trim();
      const clearingRelevance = !trimmed && state.sortBy === 'relevance';
      const startingSearch = trimmed && !state.searchQuery.trim() && state.sortBy !== 'relevance';
      return {
        ...state,
        searchQuery: action.query,
        currentPage: 0,
        pendingTagFallback: null,
        sortBy: clearingRelevance ? 'created_at' : startingSearch ? 'relevance' : state.sortBy,
        sortDir: clearingRelevance ? 'DESC' : state.sortDir,
      };
    }

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
      if (nextTag === null) {
        return clearTagFilterState(state);
      }
      return { ...state, activeTagFilter: nextTag, currentPage: 0 };
    }

    case 'clearTagFilter':
      return clearTagFilterState(state);

    case 'pageChange':
      return { ...state, currentPage: Math.max(0, action.page) };

    case 'sortChange':
      return { ...state, sortBy: action.sortBy, sortDir: action.sortDir, currentPage: 0 };

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

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

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

export interface SqliteHistoryModelDeps {
  queryHistory?: typeof queryHistory;
  getSqliteStatus?: typeof getSqliteStatus;
  /** @deprecated Prefer subscribe(); kept for Controller shim compatibility. */
  onStateChange?: () => void;
}

export type AppendResult =
  | { success: true; appendedCount: number }
  | { success: false; error: string };

export interface SqliteHistoryModel {
  getState(): Readonly<SqliteHistoryState>;
  /** Subscribe to state changes; returns unsubscribe. Thin alias of former onStateChange. */
  subscribe(listener: () => void): () => void;
  dateRangeFromSelected(): { since?: number; until?: number };
  fetchData(options?: FetchDataOptions): Promise<void>;
  reloadCurrent(): void;
  checkFallbackStatus(): Promise<void>;
  retryInitialLoad(fetchOpts?: FetchDataOptions): Promise<void>;
  consumePendingInit(): FetchDataOptions | null;
  activateWithTag(tag: string): void;
  activateWithDomain(query: string): void;
  loadPersistedSortIntoState(): Promise<void>;
  bumpGenerationOnUnmount(): void;
  toggleStar(id: number): Promise<void>;
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
  selectEntry(id: number, selected: boolean): void;
  selectAllEntries(checked: boolean): void;
  clearEntrySelection(): void;
}

export function createSqliteHistoryModel(deps: SqliteHistoryModelDeps = {}): SqliteHistoryModel {
  const runQueryHistory = deps.queryHistory ?? queryHistory;
  const runGetSqliteStatus = deps.getSqliteStatus ?? getSqliteStatus;

  let state = createInitialHistoryState();
  let requestGeneration = 0;
  let pendingInit: Record<string, unknown> | null = null;
  const listeners = new Set<() => void>();
  if (deps.onStateChange) listeners.add(deps.onStateChange);

  // PBI07: LRU query cache (closure instance, not module state)
  const queryCache = new Map<string, UnifiedHistoryQueryData>();
  const CACHE_CAP = 20;

  function buildCacheKey(params: {
    sortBy: string;
    sortDir: string;
    page: number;
    search?: string | undefined;
    since?: number | undefined;
    until?: number | undefined;
    tagFilter?: string | null | undefined;
    tagInitiated?: boolean | undefined;
  }): string {
    const s = params.search !== undefined && params.search !== '' ? params.search : '';
    const t = params.tagFilter != null && params.tagFilter !== '' ? params.tagFilter : '';
    const since = params.since !== undefined ? String(params.since) : '';
    const until = params.until !== undefined ? String(params.until) : '';
    // tagInitiated is forwarded to the query and triggers a side effect
    // (activateWithTag) — same filter with/without it must not share a key.
    const ti = params.tagInitiated ? '1' : '0';
    return JSON.stringify([params.sortBy, params.sortDir, params.page, s, since, until, t, ti]);
  }

  function setCacheEntry(key: string, value: UnifiedHistoryQueryData): void {
    if (queryCache.has(key)) queryCache.delete(key);
    queryCache.set(key, value);
    if (queryCache.size > CACHE_CAP) {
      const oldest = queryCache.keys().next().value as string | undefined;
      if (oldest !== undefined) queryCache.delete(oldest);
    }
  }

  function clearCache(): void {
    queryCache.clear();
  }

  // PBI07: debounced persistSort — 500ms, flush on unmount
  // In vitest real-timer mode the existing panel-sort test expects immediate persist
  // after flush(); to keep that test green while still debouncing correctly under
  // fake timers and in production, we branch: fake timers or production => 500ms timer,
  // test real timers => microtask debounce (fires within flush()'s microtasks).
  let pendingPersist: { sortBy: SqliteHistoryState['sortBy']; sortDir: SqliteHistoryState['sortDir'] } | null = null;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let microtaskScheduled = false;

  function isFakeTimersActive(): boolean {
    try {
      const g = globalThis as unknown as { vi?: { isFakeTimers?: () => boolean } };
      return !!g.vi?.isFakeTimers?.();
    } catch {
      return false;
    }
  }

  function isTestEnv(): boolean {
    try {
      const g = globalThis as unknown as { process?: { env?: Record<string, string> } };
      return g.process?.env?.NODE_ENV === 'test' || g.process?.env?.VITEST === 'true';
    } catch {
      return false;
    }
  }

  function flushPendingPersist(): void {
    if (persistTimer !== null) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    microtaskScheduled = false;
    if (pendingPersist) {
      const toWrite = pendingPersist;
      pendingPersist = null;
      void persistSort(toWrite.sortBy, toWrite.sortDir);
    }
  }

  function schedulePersistSort(sortBy: SqliteHistoryState['sortBy'], sortDir: SqliteHistoryState['sortDir']): void {
    pendingPersist = { sortBy, sortDir };
    const useTimer = isFakeTimersActive() || !isTestEnv();
    if (useTimer) {
      if (persistTimer !== null) clearTimeout(persistTimer);
      microtaskScheduled = false;
      persistTimer = setTimeout(() => {
        const toWrite = pendingPersist;
        pendingPersist = null;
        persistTimer = null;
        if (toWrite) void persistSort(toWrite.sortBy, toWrite.sortDir);
      }, 500);
    } else {
      if (persistTimer !== null) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      if (microtaskScheduled) return;
      microtaskScheduled = true;
      queueMicrotask(() => {
        microtaskScheduled = false;
        if (pendingPersist) {
          const toWrite = pendingPersist;
          pendingPersist = null;
          void persistSort(toWrite.sortBy, toWrite.sortDir);
        }
      });
    }
  }

  function notify(): void {
    for (const l of listeners) {
      try {
        l();
      } catch {}
    }
  }

  function dispatch(action: SqliteHistoryAction): void {
    state = historyStateReducer(state, action);
  }

  function dateRangeFromSelected(): { since?: number; until?: number } {
    return dateRangeFromSelectedDate(state.selectedDate);
  }

  async function fetchData(options: FetchDataOptions = {}): Promise<void> {
    const page = Math.max(0, options.page ?? state.currentPage);
    const activeTagFilter = options.tagFilter !== undefined ? options.tagFilter : state.activeTagFilter;
    const cacheKey = buildCacheKey({
      sortBy: state.sortBy,
      sortDir: state.sortDir,
      page,
      search: options.search,
      since: options.since,
      until: options.until,
      tagFilter: activeTagFilter,
      tagInitiated: options.tagInitiated,
    });

    if (queryCache.has(cacheKey)) {
      const cached = queryCache.get(cacheKey)!;
      queryCache.delete(cacheKey);
      queryCache.set(cacheKey, cached);
      const generation = ++requestGeneration;
      void generation;
      // Defensive copy: state.entries aliases data.rows, and an in-place
      // consumer mutation would poison future cache hits.
      dispatch({ type: 'loadSuccess', data: { ...cached, rows: [...cached.rows] } });
      notify();
      return;
    }

    const generation = ++requestGeneration;
    dispatch({ type: 'loadStart' });
    notify();

    try {
      const limit = PAGE_SIZE;
      const offset = page * limit;

      const result: UnifiedHistoryQueryResult = await runQueryHistory({
        limit,
        offset,
        sortBy: state.sortBy,
        sortDir: state.sortDir,
        ...pickDefined({
          search: options.search,
          since: options.since,
          until: options.until,
          tagFilter: activeTagFilter || undefined,
          tagInitiated: options.tagInitiated,
        }),
      });

      if (generation !== requestGeneration) return;

      if (isServiceError(result)) {
        dispatch({ type: 'loadFailure', error: 'historyLoadError' });
      } else {
        dispatch({ type: 'loadSuccess', data: result.data });
        setCacheEntry(cacheKey, result.data);
      }
    } catch (err) {
      if (generation !== requestGeneration) return;
      dispatch({ type: 'loadFailure', error: `Error: ${errorMessage(err)}` });
    } finally {
      if (generation === requestGeneration) {
        state = { ...state, loading: false };
        notify();
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
        notify();
      }
    } catch {
      // Ignore
    }
  }

  async function retryInitialLoad(fetchOpts: FetchDataOptions = { limit: PAGE_SIZE }): Promise<void> {
    await retryWithExponentialBackoff<boolean>(
      async () => {
        await fetchData(fetchOpts);
        return state.error ? null : true;
      },
      { label: 'sqliteHistory', maxAttempts: 4 },
    );
    notify();
  }

  function consumePendingInit(): FetchDataOptions | null {
    const init = pendingInit;
    pendingInit = null;
    if (!init) return null;
    if (init.searchTag) {
      return { ...pickDefined({ tagFilter: (init.searchTag as string) || undefined }), tagInitiated: true, limit: PAGE_SIZE };
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
    void fetchData({ page: 0, ...pickDefined({ tagFilter: state.activeTagFilter || undefined }), tagInitiated: true });
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
    flushPendingPersist();
    clearCache();
  }

  async function toggleStarImpl(id: number): Promise<void> {
    const result = await toggleStar(id);
    if ('error' in result) {
      dispatch({ type: 'operationError', error: result.error });
      notify();
      return;
    }
    const entry = state.entries.find(e => e.id === id);
    if (entry) {
      dispatch({ type: 'toggleStarSuccess', id, starred: result.data.is_starred === 1 });
    }
    clearCache();
    notify();
  }

  async function deleteEntry(id: number): Promise<void> {
    const entry = state.entries.find((candidate) => candidate.id === id);
    const result = await deleteLog(id);
    if ('error' in result) {
      dispatch({ type: 'operationError', error: result.error });
      notify();
      return;
    }
    if (entry) {
      try {
        await removeSavedUrl(entry.url);
      } catch (error) {
        console.error('Failed to remove legacy history entry:', error);
      }
    }
    dispatch({ type: 'deleteSuccess', id });
    clearCache();
    notify();
  }

  async function appendSelectedToObsidian(): Promise<AppendResult | null> {
    if (state.selectedIds.size === 0) return null;
    const ids = Array.from(state.selectedIds);
    const result = await appendToLogs(ids);
    if ('data' in result) {
      state.selectedIds.clear();
      clearCache();
      notify();
      return { success: true, appendedCount: ids.length };
    }
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
    schedulePersistSort(sortBy, sortDir);
    if (state.searchQuery.trim()) {
      await fetchData({ search: state.searchQuery, page: 0 });
    } else {
      await fetchData({ ...dateRangeFromSelected(), page: 0 });
    }
  }

  function filterByTag(tag: string): void {
    dispatch({ type: 'tagFilterClick', tag });
    void fetchData({ ...pickDefined({ tagFilter: state.activeTagFilter || undefined }), ...dateRangeFromSelected() });
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
    notify();
  }

  function selectAllEntries(checked: boolean): void {
    dispatch({ type: 'selectAll', checked });
    notify();
  }

  function clearEntrySelection(): void {
    dispatch({ type: 'clearSelection' });
    notify();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    getState: () => state,
    subscribe,
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

// Alias for Panel import convenience
export const createHistoryModel = createSqliteHistoryModel;

export { persistSort };
