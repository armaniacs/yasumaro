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
import { QueryCache } from './historyQueryCache.js';

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

// ---------------------------------------------------------------------------
// PersistScheduler — injectable timing policy for debounced sort persistence.
// Production default debounces via setTimeout; tests inject a microtask or
// immediate scheduler to verify synchronously without fake timers.
// ---------------------------------------------------------------------------

export interface PersistScheduler {
  defer(fn: () => void, ms: number): void;
  cancel(): void;
}

export function createTimeoutPersistScheduler(): PersistScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    defer(fn: () => void, ms: number): void {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, ms);
    },
    cancel(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
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
  /** Timing policy for debounced sort persistence; defaults to 500ms setTimeout. */
  scheduler?: PersistScheduler;
  /** @deprecated Prefer subscribe(); kept for Controller shim compatibility. */
  onStateChange?: () => void;
}

export type AppendResult =
  | { success: true; appendedCount: number }
  | { success: false; error: string };

export interface NavigateInParams {
  searchTag?: string;
  searchDomain?: string;
}

export interface SqliteHistoryModel {
  getState(): Readonly<SqliteHistoryState>;
  /** Subscribe to state changes; returns unsubscribe. Thin alias of former onStateChange. */
  subscribe(listener: () => void): () => void;
  dateRangeFromSelected(): { since?: number; until?: number };
  fetchData(options?: FetchDataOptions): Promise<void>;
  reloadCurrent(): void;
  /**
   * Navigation entry point — owns the whole navigate-in order that used to be
   * split between Panel.init (filter branch) and Panel.load (status → sort →
   * pendingInit consume → initial fetch). The Panel only decides *when* to
   * call; the Model owns the order.
   */
  onNavigateIn(initParams?: NavigateInParams): Promise<void>;
  /** Navigation exit point — generation bump + persist flush + cache clear + selection clear. */
  onNavigateOut(): void;
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

  // PBI07: LRU query cache (per-model instance, no module state).
  // PBI11: policy (key normalization, eviction, defensive copy) lives in
  // QueryCache — this model only calls buildKey/get/set/clear.
  const cache = new QueryCache(20);

  // Debounced persistSort — the timing policy lives in the injected
  // PersistScheduler (production default: 500ms setTimeout) so the model
  // never probes the test harness. Unmount flushes via flushPendingPersist.
  const scheduler = deps.scheduler ?? createTimeoutPersistScheduler();
  let pendingPersist: { sortBy: SqliteHistoryState['sortBy']; sortDir: SqliteHistoryState['sortDir'] } | null = null;

  function writePendingPersist(): void {
    if (pendingPersist) {
      const toWrite = pendingPersist;
      pendingPersist = null;
      void persistSort(toWrite.sortBy, toWrite.sortDir);
    }
  }

  function flushPendingPersist(): void {
    scheduler.cancel();
    writePendingPersist();
  }

  function schedulePersistSort(sortBy: SqliteHistoryState['sortBy'], sortDir: SqliteHistoryState['sortDir']): void {
    pendingPersist = { sortBy, sortDir };
    scheduler.defer(writePendingPersist, 500);
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
    const cacheKey = QueryCache.buildKey({
      sortBy: state.sortBy,
      sortDir: state.sortDir,
      page,
      search: options.search,
      since: options.since,
      until: options.until,
      tagFilter: activeTagFilter,
      tagInitiated: options.tagInitiated,
    });

    const cached = cache.get(cacheKey);
    if (cached !== undefined) {
      const generation = ++requestGeneration;
      void generation;
      dispatch({ type: 'loadSuccess', data: cached });
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
        cache.set(cacheKey, result.data);
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

  // Cache invalidation policy — every cache.clear() goes through here so the
  // reason for each invalidation stays readable at the call site and new
  // mutation paths cannot silently skip it. Three contracts:
  // - 'unmount': panel is torn down; drop everything, in-flight queries are
  //   already discarded via the generation bump at the same site.
  // - 'fresh-load': entries may have been recorded while this panel was not
  //   mounted (background auto-save, manual "record now"), so the unfiltered
  //   page-0 entry would otherwise keep serving a stale row set.
  // - 'mutation': this panel changed rows itself (star/delete/append), so
  //   cached pages no longer reflect storage. Mutation sites intentionally do
  //   NOT bump requestGeneration — only unmount discards in-flight queries.
  function invalidateCache(reason: 'unmount' | 'fresh-load' | 'mutation'): void {
    void reason;
    cache.clear();
  }

  function bumpGenerationOnUnmount(): void {
    requestGeneration += 1;
    flushPendingPersist();
    invalidateCache('unmount');
  }

  // Reset display filters (date/search/tag/page) so a fresh panel.load() shows
  // the latest entries instead of resuming the previous visit's narrowed view
  // (e.g. a date stuck on a past day after tab navigation). Called from
  // load() rather than only on unmount, since the registry does not call
  // destroy()/deactivate() on tab switches — the panel stays mounted and only
  // load() re-runs.
  //
  // Also clears the query cache: entries recorded while this panel was not
  // mounted (background/service-worker auto-save, manual "record now") never
  // go through toggleStar/deleteEntry/appendSelectedToObsidian, so the
  // unfiltered page-0 cache entry would otherwise keep serving a stale row
  // set even after the filter reset above.
  function resetFiltersForFreshLoad(): void {
    invalidateCache('fresh-load');
    const { sortBy, sortDir } = state;
    state = { ...createInitialHistoryState(), sortBy, sortDir };
  }

  // Navigation entry point (PBI-14): folds the init 3-branch
  // (activateWithTag / activateWithDomain / resetFiltersForFreshLoad) and the
  // load chain (checkFallbackStatus → loadPersistedSortIntoState →
  // consumePendingInit → retryInitialLoad) into one ordered method.
  //
  // Order is load-bearing: the filter branch runs before status/sort so a
  // tag/domain hand-off is already in state when the initial fetch is built,
  // and resetFiltersForFreshLoad preserves only sort (:567-568 equivalent).
  // activateWithTag fires its immediate fetch AND stages pendingInit on
  // purpose (two-stage: the retry below re-fetches the same condition, but
  // hits the cache — 1 underlying query total, pinned by contract test).
  async function onNavigateIn(initParams?: NavigateInParams): Promise<void> {
    if (initParams?.searchTag) {
      activateWithTag(initParams.searchTag);
    } else if (initParams?.searchDomain) {
      activateWithDomain(initParams.searchDomain);
    } else {
      // Plain re-navigation (no tag/domain hand-off): drop date/search/tag
      // filters left over from the previous visit. The panel stays mounted
      // across tab switches, so this is the only per-visit reset point.
      resetFiltersForFreshLoad();
    }
    await checkFallbackStatus();
    await loadPersistedSortIntoState();
    const fetchOpts = consumePendingInit();
    await retryInitialLoad(fetchOpts ?? { limit: PAGE_SIZE });
  }

  function onNavigateOut(): void {
    bumpGenerationOnUnmount();
    clearEntrySelection();
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
    invalidateCache('mutation');
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
    invalidateCache('mutation');
    notify();
  }

  async function appendSelectedToObsidian(): Promise<AppendResult | null> {
    if (state.selectedIds.size === 0) return null;
    const ids = Array.from(state.selectedIds);
    const result = await appendToLogs(ids);
    if ('data' in result) {
      state.selectedIds.clear();
      invalidateCache('mutation');
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
    onNavigateIn,
    onNavigateOut,
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
