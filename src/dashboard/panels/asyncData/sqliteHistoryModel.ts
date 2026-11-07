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
import { logError } from '../../../utils/logger/api.js';
import { ErrorCode } from '../../../utils/logger/types.js';
import { QueryCache } from './historyQueryCache.js';
import { parseCollectionQuery } from './savedCollectionQuery.js';
import { resolveCollectionHistory, orderCollectionRows } from './collectionHistoryQuery.js';
import type { CollectionWarning } from './collectionHistoryQuery.js';
import type { HistoryCustomRange } from './historyHandoff.js';
import { localDayRangeFromDateString } from '../../../utils/localDate.js';
import { ReloadGuard } from './reloadGuard.js';
import { StorageKeys } from '../../../utils/storage/types.js';
import { getPendingPages as defaultGetPendingPages } from '../../../utils/pendingStorage.js';
import type { PendingPage } from '../../../utils/pendingStorage.js';

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
  /**
   * Ephemeral custom range from the calendar quick buttons (Last 7/30 days):
   * since/until with no selectedDate. It never lands in a saved condition,
   * so the history → collection handoff (PBI 2026-11-02-03) refuses while
   * this is set instead of silently dropping to a single day. Cleared by
   * every filter change that the list query itself does not carry.
   */
  customRange: HistoryCustomRange | null;
  loading: boolean;
  error: string | null;
  fallbackMode: boolean;
  selectedIds: Set<number>;
  activeTagFilter: string | null;
  pendingTagFallback: { tag: string; fallbackTo: string; matched: number } | null;
  /**
   * v2 collection notice (PBI 2026-11-02-07): set while a multi-clause /
   * pinned collection drives the list; cleared by every filter change that
   * leaves collection mode. Null means no collection is applied (or it
   * applied cleanly with no cap hit).
   */
  collectionWarning: CollectionWarning | null;
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
    customRange: null,
    loading: false,
    error: null,
    fallbackMode: false,
    selectedIds: new Set(),
    activeTagFilter: null,
    pendingTagFallback: null,
    collectionWarning: null,
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
  | { type: 'rangeSelect'; since: number; until: number }
  | { type: 'clearFilters' }
  | { type: 'tagFilterClick'; tag: string }
  | { type: 'clearTagFilter' }
  | { type: 'pageChange'; page: number }
  | { type: 'sortChange'; sortBy: 'created_at' | 'relevance'; sortDir: 'ASC' | 'DESC' }
  | { type: 'tagInitiated'; tag: string }
  | { type: 'domainSearchInitiated'; query: string }
  // PBI 2026-10-23-06: saved-collection recall — every stored condition lands
  // in state through this one action so a recall cannot drift per field.
  | { type: 'collectionApplied'; search: string; tag: string | null; date: string | null }
  // PBI 2026-11-02-07: v2 collection recall — clauses cannot land in the
  // single search/tag/date fields, so they are cleared and the notice carries
  // what the list shows instead.
  | { type: 'collectionAppliedV2'; warning: CollectionWarning | null }
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
    collectionWarning: null,
    customRange: null,
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
      let sortBy = state.sortBy;
      if (clearingRelevance) sortBy = 'created_at';
      else if (startingSearch) sortBy = 'relevance';
      return {
        ...state,
        searchQuery: action.query,
        currentPage: 0,
        pendingTagFallback: null,
        collectionWarning: null,
        // A fresh search abandons the ephemeral range: the search query
        // carries no since/until, so keeping it would lie about the list.
        customRange: null,
        sortBy,
        sortDir: clearingRelevance ? 'DESC' : state.sortDir,
      };
    }

    case 'dateSelect':
      return {
        ...state,
        selectedDate: action.date,
        customRange: null,
        searchQuery: '',
        pendingTagFallback: null,
        collectionWarning: null,
        currentPage: 0,
      };

    case 'rangeSelect':
      return {
        ...state,
        selectedDate: null,
        customRange: { since: action.since, until: action.until },
        searchQuery: '',
        pendingTagFallback: null,
        collectionWarning: null,
        currentPage: 0,
      };

    case 'clearFilters':
      return { ...state, searchQuery: '', selectedDate: null, customRange: null, activeTagFilter: null, pendingTagFallback: null, collectionWarning: null, currentPage: 0 };

    case 'tagFilterClick': {
      const nextTag = state.activeTagFilter === action.tag ? null : action.tag;
      if (nextTag === null) {
        return clearTagFilterState(state);
      }
      // The tag query carries dateRangeFromSelected only, so an ephemeral
      // custom range no longer describes the list once a tag is picked.
      return { ...state, activeTagFilter: nextTag, customRange: null, collectionWarning: null, currentPage: 0 };
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
        customRange: null,
        currentPage: 0,
        pendingTagFallback: null,
        collectionWarning: null,
        searchQuery: action.tag,
      };

    case 'domainSearchInitiated':
      return { ...state, searchQuery: action.query, customRange: null, collectionWarning: null, currentPage: 0 };

    // PBI 2026-10-23-06: recall applies every stored condition in one pass.
    // The current sort is preserved on purpose — a collection is a named
    // condition, not a sort choice.
    case 'collectionApplied':
      return {
        ...state,
        searchQuery: action.search,
        activeTagFilter: action.tag,
        selectedDate: action.date,
        customRange: null,
        pendingTagFallback: null,
        collectionWarning: null,
        currentPage: 0,
      };

    // PBI 2026-11-02-07: v2 recall — clauses cannot land in the single
    // search/tag/date fields, so they are cleared and the warning carries
    // what the list shows instead. Sort direction is preserved.
    case 'collectionAppliedV2':
      return {
        ...state,
        searchQuery: '',
        activeTagFilter: null,
        selectedDate: null,
        customRange: null,
        pendingTagFallback: null,
        collectionWarning: action.warning,
        currentPage: 0,
      };

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

/**
 * Page size shared by the query defaults (this model) and the pagination
 * wiring (sqliteHistoryPanelView imports it) — one constant so the listing
 * limit and the pagination control cannot disagree (PBI 04).
 */
export const SQLITE_HISTORY_PAGE_SIZE = 20;
// Sort persistence key — SSOT via StorageKeys.HISTORY_SORT_PREFERENCE so the
// panel's storage-key table stays the only place the key name lives.
const HISTORY_SORT_STORAGE_KEY = StorageKeys.HISTORY_SORT_PREFERENCE;

/** Sort 永続化の adapter（PBI 2026-09-15-11）: chrome.storage 直結を interface
 *  の後ろに隠し、テストで注入可能に。既定は chrome.storage.local 実装。 */
export interface SortPreferencePersistence {
    load(): Promise<{ sortBy: SqliteHistoryState['sortBy']; sortDir: SqliteHistoryState['sortDir'] } | null>;
    save(sortBy: SqliteHistoryState['sortBy'], sortDir: SqliteHistoryState['sortDir']): Promise<void>;
}

function createChromeSortPreferencePersistence(): SortPreferencePersistence {
    return {
        async load(): Promise<{ sortBy: SqliteHistoryState['sortBy']; sortDir: SqliteHistoryState['sortDir'] } | null> {
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
        },
        async save(sortBy: SqliteHistoryState['sortBy'], sortDir: SqliteHistoryState['sortDir']): Promise<void> {
            try {
                await chrome.storage.local.set({ [HISTORY_SORT_STORAGE_KEY]: JSON.stringify({ sortBy, sortDir }) });
            } catch (error) {
                // Sort falls back to in-memory state; the failure stays
                // visible via the structured-log seam instead of console.
                void logError('Failed to persist history sort preference', { error: errorMessage(error) }, ErrorCode.STORAGE_WRITE_FAILURE, 'sqliteHistoryModel');
            }
        },
    };
}

// 既定は chrome 実装。テストは setSortPersistenceOverride で差し替える。
let sortPersistence: SortPreferencePersistence = createChromeSortPreferencePersistence();

/** テスト用: sort 永続化 adapter を差し替える（null で chrome 実装に戻す）。 */
export function setSortPersistenceOverride(persistence: SortPreferencePersistence | null): void {
    sortPersistence = persistence ?? createChromeSortPreferencePersistence();
}

async function persistSort(sortBy: SqliteHistoryState['sortBy'], sortDir: SqliteHistoryState['sortDir']): Promise<void> {
    await sortPersistence.save(sortBy, sortDir);
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
  /**
   * PBI 16: timing policy for the debounced search input. Separate instance
   * from `scheduler` (sort persistence) so the two debounces never share a
   * timer. Defaults to setTimeout.
   */
  searchScheduler?: PersistScheduler;
  /**
   * PBI 16: pending-pages source. Defaults to chrome.storage-backed
   * getPendingPages + onChanged; tests inject a fake.
   */
  pendingPages?: PendingPagesSource;
  /** @deprecated Prefer subscribe(); kept for Controller shim compatibility. */
  onStateChange?: () => void;
}

/**
 * PBI 16: pending-pages seam. `load` reads the current list; `subscribe`
 * registers a live-update callback and returns its unsubscribe. The chrome
 * default is side-effect-free at creation — listeners attach in
 * startPendingPagesSubscription, never in the factory.
 */
export interface PendingPagesSource {
  load(): Promise<PendingPage[]>;
  subscribe(onChange: () => void): () => void;
}

function createChromePendingPagesSource(): PendingPagesSource {
  return {
    load(): Promise<PendingPage[]> {
      return defaultGetPendingPages();
    },
    subscribe(onChange: () => void): () => void {
      if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) {
        return () => undefined;
      }
      const listener = (changes: Record<string, unknown>, areaName: string): void => {
        if (areaName === 'local' && changes['pending_pages']) {
          onChange();
        }
      };
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener(listener);
    },
  };
}

/** PBI 16: the filter triple the history→collection handoff reads. */
export interface HistoryHandoffSource {
  searchQuery: string;
  activeTagFilter: string | null;
  selectedDate: string | null;
  customRange: HistoryCustomRange | null;
}

export type AppendResult =
  { success: true; appendedCount: number }
  | { success: false; error: string };

export type BulkDeleteResult = {
  deletedCount: number;
  error: string | null;
};

// PBI 2026-10-23-07: bulk star result — changedIds drives the undo (the rows
// this batch actually flipped), the counters explain the partial outcome.
export type BulkStarResult = {
  starredCount: number;
  skippedAlreadyInState: number;
  error: string | null;
  changedIds: number[];
};

/**
 * Privacy-judged predicate (PBI 2026-10-23-07): the record's content went
 * through PII masking. Pure — the panel shows the count, the bulk star uses
 * it for the exclusion branch.
 */
export function isPrivacyJudgedEntry(entry: BrowsingLogEntry): boolean {
  return (entry.masked_count ?? 0) > 0;
}

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
  deleteSelectedEntries(): Promise<BulkDeleteResult>;
  search(query: string): void;
  /**
   * PBI 16: debounced search entry point — the single owner of the pending
   * input. Stores the latest keystroke and dispatches via the injected
   * searchScheduler (300ms production default); tests inject an immediate
   * scheduler. Replaces the former panel-side debounce timer.
   */
  searchInput(query: string): void;
  /** PBI 16: synchronously dispatch a still-debounced input, if any. */
  flushPendingSearch(): void;
  /**
   * PBI 16: handoff read — flushes a still-debounced input BEFORE returning
   * the filter triple, so a fill+click-send sequence can never read pre-input
   * state. The flush ordering lives inside this one method; callers have no
   * order to get wrong (the former panel-side flushPendingSearch hack).
   */
  readHandoffSource(): HistoryHandoffSource;
  /** PBI 16: current pending-pages list owned by the model. */
  getPendingPages(): PendingPage[];
  /** PBI 16: subscribe to pending-pages changes; returns unsubscribe. */
  subscribePending(listener: () => void): () => void;
  /** PBI 16: (re)load the pending-pages list and notify subscribers. */
  loadPendingPages(): Promise<void>;
  /**
   * PBI 16: start/stop the pending-pages live subscription. The panel decides
   * *when* (load/destroy); the model owns *how*. Idempotent.
   */
  startPendingPagesSubscription(): void;
  stopPendingPagesSubscription(): void;
  /**
   * Recall convention (PBI 2026-11-02-03): the recall target is the
   * collections panel draft (`applyToDraft` / `editor.loadSaved`) — NOT
   * the history list.
   *
   * @deprecated v1-only legacy path. Parses the flat v1 shape
   * (search/tag/date) and paints it into the history list. No production
   * caller remains (recall goes to the collections draft since PBI
   * 2026-11-01-04); kept for v1-shaped restores with its PBI 2026-10-23-06
   * behavior pinned by tests. Do not extend — extend the draft handoff
   * (`historyHandoff.ts`) instead.
   */
  applyCollection(rawQuery: Record<string, unknown>): void;
  /**
   * v2 collection execution (PBI 2026-11-02-07): fan-out per clause via the
   * injected queryHistory, mergeClauseResults UNION pins, created_at-ordered
   * and capped at MAX_COLLECTION_ROWS. The merged set is cached so paging
   * slices from it; any filter change leaves collection mode. The legacy v1
   * applyCollection above is untouched — this is the new path, not a change
   * to it.
   */
  applyCollectionQuery(rawQuery: unknown): Promise<void>;
  /**
   * Bulk star (PBI 2026-10-23-07): set or unset the star for the given ids.
   * Rows already in the target state are skipped (never toggled down by a
   * bulk star); the undo re-runs the same core over the changed ids.
   */
  bulkSetStarred(ids: number[], starred: boolean): Promise<BulkStarResult>;
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
  const guard = new ReloadGuard();
  let pendingInit: Record<string, unknown> | null = null;
  const listeners = new Set<() => void>();
  if (deps.onStateChange) listeners.add(deps.onStateChange);

  // PBI07: LRU query cache (per-model instance, no module state).
  // PBI11: policy (key normalization, eviction, defensive copy) lives in
  // QueryCache — this model only calls buildKey/get/set/clear.
  const cache = new QueryCache(20);

  // PBI 2026-11-02-07: v2 collection page source. While set, the list shows
  // this merged set (created_at-ordered, already capped) and changePage /
  // reloadCurrent slice from it instead of issuing a fresh fetch. Any filter
  // change (search/date/tag/clear, v1 recall, navigation) resets it to null
  // via leaveCollectionMode and the list returns to query-driven fetching.
  let collectionRows: BrowsingLogEntry[] | null = null;

  function leaveCollectionMode(): void {
    collectionRows = null;
  }

  /** Current page slice of the cached collection set (page clamped). */
  function collectionPageSlice(page: number): { rows: BrowsingLogEntry[]; total: number } {
    const rows = collectionRows ?? [];
    const start = clampCollectionPage(page) * SQLITE_HISTORY_PAGE_SIZE;
    return { rows: rows.slice(start, start + SQLITE_HISTORY_PAGE_SIZE), total: rows.length };
  }

  /**
   * Last-page clamp for the cached collection set (C-#9): an over-range
   * page lands on the final page instead of painting an empty list. The
   * SQL path needs no twin — LIMIT/OFFSET over-fetch already returns the
   * tail there; only the client-side slice can show "nothing" mid-data.
   */
  function clampCollectionPage(page: number): number {
    const rows = collectionRows ?? [];
    const maxPage = Math.max(0, Math.ceil(rows.length / SQLITE_HISTORY_PAGE_SIZE) - 1);
    return Math.min(Math.max(0, page), maxPage);
  }

  function dispatchCollectionPage(page: number): void {
    dispatch({ type: 'pageChange', page: clampCollectionPage(page) });
    const slice = collectionPageSlice(state.currentPage);
    dispatch({ type: 'loadSuccess', data: { rows: slice.rows, total: slice.total } });
    notify();
  }

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

  // PBI 16: debounced search ownership (moved from the panel-local
  // pendingSearchQuery + setTimeout). The handoff reads through
  // readHandoffSource so flush-before-read cannot be skipped by a caller.
  let pendingSearchQuery: string | null = null;
  const searchScheduler = deps.searchScheduler ?? createTimeoutPersistScheduler();

  function searchInput(query: string): void {
    pendingSearchQuery = query;
    searchScheduler.defer(() => {
      if (pendingSearchQuery !== null) {
        const flushed = pendingSearchQuery;
        pendingSearchQuery = null;
        search(flushed);
      }
    }, 300);
  }

  function flushPendingSearch(): void {
    searchScheduler.cancel();
    if (pendingSearchQuery !== null) {
      const flushed = pendingSearchQuery;
      pendingSearchQuery = null;
      search(flushed);
    }
  }

  function cancelPendingSearch(): void {
    searchScheduler.cancel();
    pendingSearchQuery = null;
  }

  function readHandoffSource(): HistoryHandoffSource {
    flushPendingSearch();
    return {
      searchQuery: state.searchQuery,
      activeTagFilter: state.activeTagFilter,
      selectedDate: state.selectedDate,
      customRange: state.customRange,
    };
  }

  // PBI 16: pending-pages ownership (moved from panel-local state). The list
  // lives here; change notification flows through a dedicated listener set so
  // a history refresh never repaints the pending region (which would wipe
  // in-row record-error DOM state) and a pending update never re-renders the
  // entry list.
  let pendingPages: PendingPage[] = [];
  const pendingListeners = new Set<() => void>();
  const pendingSource = deps.pendingPages ?? createChromePendingPagesSource();
  let stopPendingSource: (() => void) | null = null;

  function notifyPending(): void {
    for (const l of [...pendingListeners]) {
      try {
        l();
      } catch (error: unknown) {
        void logError('sqliteHistoryModel: pending subscriber threw during notify', { error: errorMessage(error) }, ErrorCode.INTERNAL_ERROR, 'sqliteHistoryModel');
      }
    }
  }

  async function loadPendingPages(): Promise<void> {
    pendingPages = await pendingSource.load();
    notifyPending();
  }

  function startPendingPagesSubscription(): void {
    if (stopPendingSource !== null) return;
    stopPendingSource = pendingSource.subscribe(() => {
      void loadPendingPages();
    });
  }

  function stopPendingPagesSubscription(): void {
    if (stopPendingSource !== null) {
      stopPendingSource();
      stopPendingSource = null;
    }
    pendingPages = [];
  }

  function subscribePending(listener: () => void): () => void {
    pendingListeners.add(listener);
    return () => pendingListeners.delete(listener);
  }

  function notify(): void {
    for (const l of listeners) {
      try {
        l();
      } catch (error: unknown) {
        // Observer rule: one bad listener must not break the rest. Listener
        // exceptions are bugs, so keep them visible via the seam (was silent).
        void logError('sqliteHistoryModel: subscriber threw during notify', { error: errorMessage(error) }, ErrorCode.INTERNAL_ERROR, 'sqliteHistoryModel');
      }
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
      guard.start();
      dispatch({ type: 'loadSuccess', data: cached });
      notify();
      return;
    }

    const generation = guard.start();
    dispatch({ type: 'loadStart' });
    notify();

    try {
      const limit = SQLITE_HISTORY_PAGE_SIZE;
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

      if (!guard.isCurrent(generation)) return;

      if (isServiceError(result)) {
        dispatch({ type: 'loadFailure', error: 'historyLoadError' });
      } else {
        dispatch({ type: 'loadSuccess', data: result.data });
        cache.set(cacheKey, result.data);
      }
    } catch (err) {
      if (!guard.isCurrent(generation)) return;
      dispatch({ type: 'loadFailure', error: `Error: ${errorMessage(err)}` });
    } finally {
      if (guard.isCurrent(generation)) {
        state = { ...state, loading: false };
        notify();
      }
    }
  }

  function reloadCurrent(): void {
    if (collectionRows !== null) {
      const slice = collectionPageSlice(state.currentPage);
      dispatch({ type: 'loadSuccess', data: { rows: slice.rows, total: slice.total } });
      notify();
      return;
    }
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

  async function retryInitialLoad(fetchOpts: FetchDataOptions = { limit: SQLITE_HISTORY_PAGE_SIZE }): Promise<void> {
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
    if (typeof init.searchTag === 'string') {
      const tag = init.searchTag;
      return { ...pickDefined({ tagFilter: tag || undefined }), tagInitiated: true, limit: SQLITE_HISTORY_PAGE_SIZE };
    }
    if (typeof init.searchDomain === 'string') {
      const q = init.searchDomain.trim();
      if (q) return { search: q, limit: SQLITE_HISTORY_PAGE_SIZE };
    }
    return null;
  }

  function activateWithTag(tag: string): void {
    leaveCollectionMode();
    pendingInit = { searchTag: tag };
    dispatch({ type: 'tagInitiated', tag });
    void fetchData({ page: 0, ...pickDefined({ tagFilter: state.activeTagFilter || undefined }), tagInitiated: true });
  }

  function activateWithDomain(query: string): void {
    leaveCollectionMode();
    pendingInit = { searchDomain: query };
    dispatch({ type: 'domainSearchInitiated', query });
    if (state.searchQuery.trim()) {
      void fetchData({ search: state.searchQuery.trim() });
    }
  }

  async function loadPersistedSortIntoState(): Promise<void> {
    const persistedSort = await sortPersistence.load();
    if (persistedSort) {
      state = { ...state, sortBy: persistedSort.sortBy, sortDir: persistedSort.sortDir };
    }
  }

  // Cache invalidation — every cache.clear() goes through here so new
  // mutation paths cannot silently skip it. Callers:
  // - unmount: panel is torn down; in-flight queries are already discarded
  //   via the generation bump at the same site.
  // - fresh-load: entries may have been recorded while this panel was not
  //   mounted (background auto-save, manual "record now"), so the unfiltered
  //   page-0 entry would otherwise keep serving a stale row set.
  // - mutation (via mutateWithInvalidation below): this panel changed rows
  //   itself (star/delete/append), so cached pages no longer reflect storage.
  //   Mutation sites intentionally do NOT invalidate the guard — only unmount
  //   discards in-flight queries.
  function invalidateCache(): void {
    cache.clear();
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
    invalidateCache();
    leaveCollectionMode();
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
    await retryInitialLoad(fetchOpts ?? { limit: SQLITE_HISTORY_PAGE_SIZE });
  }

  function onNavigateOut(): void {
    // Flush (not drop) the debounced sort persist: the timer would otherwise
    // fire post-unmount. Flushing preserves the user's sort choice.
    guard.invalidate();
    flushPendingPersist();
    // PBI 16: a still-debounced search keystroke is discarded here, not
    // flushed — leaving the screen must not issue a query for text the user
    // never committed (and the timer must not fire post-unmount).
    cancelPendingSearch();
    invalidateCache();
    clearEntrySelection();
  }

  // Mutation post-processing funnel — every star/delete/append goes through
  // here so dispatch → invalidation → notify cannot drift per call site.
  // Error path early-returns before invalidation (storage is unchanged, so
  // there is nothing to drop). Success with a null action still invalidates
  // and notifies (row was not in the current page, but caches are stale).
  type MutationOutcome =
    | { kind: 'success'; action: SqliteHistoryAction | null }
    | { kind: 'error'; error: string };

  async function mutateWithInvalidation(
    fn: () => Promise<MutationOutcome>,
  ): Promise<MutationOutcome> {
    const outcome = await fn();
    if (outcome.kind === 'error') {
      dispatch({ type: 'operationError', error: outcome.error });
      notify();
      return outcome;
    }
    if (outcome.action) {
      dispatch(outcome.action);
    }
    invalidateCache();
    notify();
    return outcome;
  }

  // Single-row delete core shared by deleteEntry and deleteSelectedEntries:
  // storage delete + legacy URL cleanup only, no dispatch/notify (callers
  // funnel those through mutateWithInvalidation). Returns the error or null.
  async function deleteSingleEntry(id: number, url?: string): Promise<string | null> {
    const result = await deleteLog(id);
    if (isServiceError(result)) {
      return result.error;
    }
    if (url) {
      try {
        await removeSavedUrl(url);
      } catch (error) {
        // Legacy cleanup is best-effort (SQLite row is already gone); the
        // failure stays visible via the structured-log seam instead of console.
        void logError('Failed to remove legacy history entry', { error: errorMessage(error) }, ErrorCode.STORAGE_WRITE_FAILURE, 'sqliteHistoryModel');
      }
    }
    return null;
  }

  async function toggleStarImpl(id: number): Promise<void> {
    await mutateWithInvalidation(async () => {
      const result = await toggleStar(id);
      if (isServiceError(result)) {
        return { kind: 'error', error: result.error };
      }
      const entry = state.entries.find(e => e.id === id);
      if (!entry) {
        return { kind: 'success', action: null };
      }
      const starred = result.data.is_starred === 1;
      if (collectionRows !== null) {
        collectionRows = collectionRows.map((row) =>
          row.id === id ? { ...row, is_starred: starred ? 1 : 0 } : row,
        );
      }
      return {
        kind: 'success',
        action: { type: 'toggleStarSuccess', id, starred },
      };
    });
  }

  async function deleteEntry(id: number): Promise<void> {
    const entry = state.entries.find((candidate) => candidate.id === id);
    await mutateWithInvalidation(async () => {
      const failure = await deleteSingleEntry(id, entry?.url);
      if (failure !== null) {
        return { kind: 'error', error: failure };
      }
      if (collectionRows !== null) {
        collectionRows = collectionRows.filter((row) => row.id !== id);
      }
      return { kind: 'success', action: { type: 'deleteSuccess', id } };
    });
  }

  /** Bulk delete of the checked rows — stops at the first failure, reports both counts. */
  async function deleteSelectedEntries(): Promise<BulkDeleteResult> {
    if (state.selectedIds.size === 0) return { deletedCount: 0, error: null };
    // Snapshot: deleteSuccess mutates selectedIds as we go.
    // URL collection only — the per-row delete itself delegates to
    // deleteSingleEntry so the error policy matches deleteEntry.
    const ids = Array.from(state.selectedIds);
    const urls = new Map<number, string>();
    for (const entry of state.entries) {
      if (state.selectedIds.has(entry.id) && entry.url) urls.set(entry.id, entry.url);
    }
    let deletedCount = 0;
    let error: string | null = null;
    await mutateWithInvalidation(async () => {
      for (const id of ids) {
        const failure = await deleteSingleEntry(id, urls.get(id));
        if (failure !== null) {
          error = failure;
          break;
        }
        dispatch({ type: 'deleteSuccess', id });
        if (collectionRows !== null) {
          collectionRows = collectionRows.filter((row) => row.id !== id);
        }
        deletedCount += 1;
      }
      if (deletedCount === 0 && error !== null) {
        return { kind: 'error', error };
      }
      return { kind: 'success', action: null };
    });
    return { deletedCount, error };
  }

  // PBI 2026-10-23-07: bulk star core shared by the apply and the undo. Rows
  // already in the target state are skipped — a bulk star must never toggle
  // an already-starred row down. The undo re-runs this core over the batch's
  // changed ids, so a manual star between apply and undo is reverted with the
  // batch (the undo restores the batch, not per-row history).
  async function bulkSetStarred(ids: number[], starred: boolean): Promise<BulkStarResult> {
    let flipped = 0;
    let skippedAlreadyInState = 0;
    let error: string | null = null;
    const changedIds: number[] = [];
    await mutateWithInvalidation(async () => {
      for (const id of ids) {
        const entry = state.entries.find((candidate) => candidate.id === id);
        if (!entry || entry.is_starred === (starred ? 1 : 0)) {
          skippedAlreadyInState += 1;
          continue;
        }
        const result = await toggleStar(id);
        if (isServiceError(result)) {
          error = result.error;
          break;
        }
        dispatch({ type: 'toggleStarSuccess', id, starred: result.data.is_starred === 1 });
        changedIds.push(id);
        flipped += 1;
      }
      if (changedIds.length === 0 && error !== null) {
        return { kind: 'error', error };
      }
      return { kind: 'success', action: null };
    });
    return { starredCount: flipped, skippedAlreadyInState, error, changedIds };
  }

  async function appendSelectedToObsidian(): Promise<AppendResult | null> {
    if (state.selectedIds.size === 0) return null;
    const ids = Array.from(state.selectedIds);
    const result = await appendToLogs(ids);
    if (isServiceError(result)) {
      await mutateWithInvalidation(async () => ({ kind: 'error', error: result.error }));
      return { success: false, error: result.error };
    }
    await mutateWithInvalidation(async () => ({ kind: 'success', action: { type: 'appendSuccess' } }));
    return { success: true, appendedCount: ids.length };
  }

  function search(query: string): void {
    leaveCollectionMode();
    dispatch({ type: 'search', query });
    if (query.trim()) {
      void fetchData({ search: query.trim() });
    } else {
      void fetchData({ page: 0 });
    }
  }

  // v1-only legacy path (PBI 2026-11-02-03 recall convention): recall lands
  // in the collections draft, not here. This entry point only parses the
  // flat v1 shape (savedCollectionQuery 縮退の出口: corrupted query degrades
  // to the empty condition); the model only dispatches state and builds one fetch with
  // every stored condition — search, tag filter and the selected day range.
  function applyCollection(rawQuery: Record<string, unknown>): void {
    leaveCollectionMode();
    const parsed = parseCollectionQuery(rawQuery);
    dispatch({
      type: 'collectionApplied',
      search: parsed.search,
      tag: parsed.tag,
      date: parsed.date,
    });
    notify();
    const dayRange = parsed.date !== null ? localDayRangeFromDateString(parsed.date) : null;
    void fetchData({
      ...pickDefined({
        search: parsed.search !== '' ? parsed.search : undefined,
        tagFilter: parsed.tag ?? undefined,
        since: dayRange?.since,
        until: dayRange?.until,
      }),
      page: 0,
    });
  }

  // v2 collection execution (PBI 2026-11-02-07): fan-out per clause via the
  // injected queryHistory (DI, same seam as fetchData), mergeClauseResults
  // UNION pins, created_at-ordered and capped. The merged set stays cached
  // so changePage / reloadCurrent slice from it with paging support; any
  // filter change leaves collection mode. Deleted-missing pins are excluded
  // by resolveCollectionHistory, so this never throws for them.
  async function applyCollectionQuery(rawQuery: unknown): Promise<void> {
    const generation = guard.start();
    leaveCollectionMode();
    invalidateCache();
    dispatch({ type: 'loadStart' });
    notify();
    const outcome = await resolveCollectionHistory(rawQuery, runQueryHistory, {
      sortDir: state.sortDir,
    });
    if (!guard.isCurrent(generation)) return;
    if ('error' in outcome) {
      leaveCollectionMode();
      dispatch({ type: 'loadFailure', error: outcome.error });
      notify();
      return;
    }
    collectionRows = outcome.data.rows;
    dispatch({ type: 'collectionAppliedV2', warning: outcome.data.warning });
    const slice = collectionPageSlice(0);
    dispatch({ type: 'loadSuccess', data: { rows: slice.rows, total: slice.total } });
    notify();
  }

  async function selectDate(dateStr: string): Promise<void> {
    leaveCollectionMode();
    dispatch({ type: 'dateSelect', date: dateStr });
    await fetchData(localDayRangeFromDateString(dateStr));
  }

  async function changeSort(sortBy: SqliteHistoryState['sortBy'], sortDir: SqliteHistoryState['sortDir']): Promise<void> {
    if (collectionRows !== null) {
      // Collection mode has no rank: relevance is per-clause FTS5 output and
      // meaningless across merged clauses, so the key coerces to created_at
      // while the direction is honored (documented + pinned by test).
      dispatch({ type: 'sortChange', sortBy: 'created_at', sortDir });
      schedulePersistSort('created_at', sortDir);
      collectionRows = orderCollectionRows(collectionRows, sortDir);
      dispatchCollectionPage(0);
      return;
    }
    dispatch({ type: 'sortChange', sortBy, sortDir });
    schedulePersistSort(sortBy, sortDir);
    if (state.searchQuery.trim()) {
      await fetchData({ search: state.searchQuery, page: 0 });
    } else {
      await fetchData({ ...dateRangeFromSelected(), page: 0 });
    }
  }

  function filterByTag(tag: string): void {
    leaveCollectionMode();
    dispatch({ type: 'tagFilterClick', tag });
    void fetchData({ ...pickDefined({ tagFilter: state.activeTagFilter || undefined }), ...dateRangeFromSelected() });
  }

  function clearTagFilter(): void {
    leaveCollectionMode();
    const hadFallback = state.pendingTagFallback !== null;
    dispatch({ type: 'clearTagFilter' });
    if (hadFallback && state.searchQuery) dispatch({ type: 'search', query: '' });
    void fetchData({ page: 0, ...dateRangeFromSelected() });
  }

  function selectDateRange(since: number, until: number): void {
    leaveCollectionMode();
    dispatch({ type: 'rangeSelect', since, until });
    void fetchData({ since, until });
  }

  function clearAllFilters(): void {
    leaveCollectionMode();
    dispatch({ type: 'clearFilters' });
    void fetchData();
  }

  function changePage(page: number): void {
    if (collectionRows !== null) {
      dispatchCollectionPage(page);
      return;
    }
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
    deleteSelectedEntries,
    bulkSetStarred,
    search,
    searchInput,
    flushPendingSearch,
    readHandoffSource,
    getPendingPages: () => pendingPages,
    subscribePending,
    loadPendingPages,
    startPendingPagesSubscription,
    stopPendingPagesSubscription,
    applyCollection,
    applyCollectionQuery,
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
