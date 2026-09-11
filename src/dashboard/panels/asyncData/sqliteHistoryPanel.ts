import { getMessageOr } from '../../../utils/i18n.js';
import type { BrowsingLogEntry } from './sqliteHistoryQuery.js';
import { showConfirmDialog } from '../../utils/confirmDialog.js';
import { createCopyMarkdownButton } from '../../../utils/copyMarkdownButton.js';
import { type PanelLifecycle } from '../types.js';
import { getPluralKey } from '../../../utils/i18nPlural.js';
import type { SqliteHistoryState } from './sqliteHistoryModel.js';
import { createSqliteHistoryModel } from './sqliteHistoryModel.js';
import { notify } from '../../notificationService.js';
import { getPendingPages, removePendingPages } from '../../../utils/pendingStorage.js';
import type { PendingPage } from '../../../utils/pendingStorage.js';
import { CURRENT_PROTOCOL_VERSION } from '../../../background/messageTypes.js';
import {
  formatDiagnosticMetadataHtml,
  render as renderHistoryView,
  renderPendingRegion,
  toggleContentArea,
} from './sqliteHistoryPanelView.js';
import type { PendingRegionActions, SqliteHistoryViewCallbacks } from './sqliteHistoryPanelView.js';

export { formatDiagnosticMetadataHtml };

function t(key: string, substitutions?: string | string[]): string {
  return getMessageOr(key, key, substitutions);
}

export function createSqliteHistoryPanel(): PanelLifecycle {
  let container: HTMLElement | null = null;
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let _isMounted = false;

  const model = createSqliteHistoryModel();
  // Panel shrinks to model.subscribe(refresh): every state change funnels
  // through view.render()'s single entry (PBI 23).
  let unsubscribe: (() => void) | null = null;
  // init() may run without a container (registry init→load order), so init
  // stays side-effect-free and only stashes params for load().
  let pendingNavParams: { searchTag?: string; searchDomain?: string } | null = null;

  // --- Pending pages (PBI 2026-09-11-02, PBI-P) -----------------------------
  // Panel-local state (NOT model state): pending pages are chrome.storage
  // content, independent of the SQLite query pipeline. Live updates come from
  // a chrome.storage.onChanged subscription, released in destroy().
  let pendingPages: PendingPage[] = [];
  let unsubscribePendingStorage: (() => void) | null = null;

  function state(): SqliteHistoryState {
    return model.getState();
  }

  /** Translate a loadFailure error: an i18n key (from the model) or a raw "Error: ..." string. */
  function translateHistoryError(error: string | null): string {
    if (!error) return '';
    return error.startsWith('Error: ') ? error : t(error);
  }

  async function handleToggleStar(id: number): Promise<void> {
    await model.toggleStar(id);
  }

  async function handleDelete(id: number): Promise<void> {
    const confirmed = await showConfirmDialog({
      title: t('sqliteHistoryTitle'),
      message: t('historyDeleteConfirm'),
      confirmLabel: t('confirmDelete'),
      cancelLabel: t('cancel'),
      dangerous: true,
    });
    if (!confirmed) return;
    await model.deleteEntry(id);
  }

  function createCopyButton(entry: BrowsingLogEntry): HTMLButtonElement {
    return createCopyMarkdownButton(entry, {
      className: 'history-copy-btn sqlite-entry-copy',
      labels: {
        initialText: '📋',
        successText: '✓',
        failureText: '✗',
        initialAriaLabel: t('copyMarkdown') || 'Copy Markdown',
        successAriaLabel: t('copyMarkdownSuccess') || 'Copied to clipboard',
        failureAriaLabel: t('copyMarkdownError'),
      },
    });
  }

  async function handleAppendToObsidian(): Promise<void> {
    const result = await model.appendSelectedToObsidian();
    if (!result) return;

    if (result.success) {
      notify(
        t('historyAppendToObsidian'),
        t(getPluralKey('historyAppendSuccess', result.appendedCount), [String(result.appendedCount)]),
      );
      return;
    }

    notify(
      t('historyAppendToObsidian'),
      `${t('historyAppendFailed')}: ${result.error}`,
    );
  }

  // The single callback bundle handed to view.render(). Every entry-list /
  // calendar / sort / pagination / bulk-bar / tag-filter interaction runs
  // through this one construction site — adding a callback means editing
  // here only, never two render paths.
  function createCallbacks(): SqliteHistoryViewCallbacks {
    return {
      onDateSelect: (d) => void model.selectDate(d),
      onRangeSelect: (since, until) => model.selectDateRange(since, until),
      onClearFilters: () => model.clearAllFilters(),
      onSearchInput: (query) => debouncedSearch(query),
      onSortChange: (sortBy, sortDir) => void model.changeSort(sortBy, sortDir),
      onPageChange: (page) => model.changePage(page),
      onToggleStar: (id) => void handleToggleStar(id),
      onDelete: (id) => void handleDelete(id),
      onSelectionChange: (id, selected) => model.selectEntry(id, selected),
      onTagFilterClick: (tag) => model.filterByTag(tag),
      onContentToggle: (controlsId) => toggleContentArea(container ?? document, controlsId),
      onSelectAll: (checked) => model.selectAllEntries(checked),
      onClearSelection: () => model.clearEntrySelection(),
      onAppend: () => void handleAppendToObsidian(),
      onTagFilterClear: () => model.clearTagFilter(),
      translateError: translateHistoryError,
      createCopyButton,
    };
  }

  const debouncedSearch = (() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (query: string) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        model.search(query);
        timer = null;
      }, 300);
      searchDebounceTimer = timer;
    };
  })();

  // Render ownership lives in the View (PBI 23): the diff/full decision is
  // view.render()'s single entry, so refresh() is a one-line delegation.
  function refresh(): void {
    if (!container) return;
    renderHistoryView(container, state(), createCallbacks());
  }

  // --- Pending pages (PBI-P) ------------------------------------------------

  function renderPending(): void {
    if (!container) return;
    renderPendingRegion(container, pendingPages, createPendingActions());
  }

  async function loadPending(): Promise<void> {
    pendingPages = await getPendingPages();
    renderPending();
  }

  function createPendingActions(): PendingRegionActions {
    return {
      onRecord: (url) => recordPending(url, false),
      onRecordWithoutAi: (url) => recordPending(url, true),
      onDelete: async (url) => {
        await removePendingPages([url]);
        await loadPending();
      },
    };
  }

  /** MANUAL_RECORD with the 20s timeout contract the legacy pending panel used. */
  async function recordPending(url: string, skipAi: boolean): Promise<{ ok: boolean; error?: string }> {
    const page = pendingPages.find((p) => p.url === url);
    if (!page) return { ok: false, error: t('recordError') };
    try {
      const result = await Promise.race([
        chrome.runtime.sendMessage({
          type: 'MANUAL_RECORD',
          protocolVersion: CURRENT_PROTOCOL_VERSION,
          payload: { title: page.title, url: page.url, content: '', force: true, skipAi },
        }),
        new Promise<never>((_, reject) => setTimeout(
          () => reject(new Error(t('recordRequestTimedOut'))),
          20000,
        )),
      ]) as { success?: boolean; error?: string } | undefined;
      if (result?.success) {
        await removePendingPages([url]);
        await loadPending();
        return { ok: true };
      }
      return { ok: false, error: result?.error || t('recordError') };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : t('recordError') };
    }
  }

  function subscribePendingStorage(): void {
    if (unsubscribePendingStorage || typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
    const listener = (changes: Record<string, unknown>, areaName: string) => {
      if (areaName === 'local' && changes['pending_pages']) {
        void loadPending();
      }
    };
    chrome.storage.onChanged.addListener(listener);
    unsubscribePendingStorage = () => chrome.storage.onChanged.removeListener(listener);
  }

  // Model subscription — thin alias of former onStateChange, completes BDD happy path
  unsubscribe = model.subscribe(() => refresh());

  return {
    id: 'panel-sqlite-history',
    category: 'async-data',
    mount(c: HTMLElement) {
      container = c;
    },
    init(initParams?: Record<string, unknown>) {
      // Side-effect-free: the registry may call init() before mount().
      // The params are consumed exactly once by the next load().
      if (initParams?.searchTag || initParams?.searchDomain) {
        pendingNavParams = {
          ...(typeof initParams.searchTag === 'string' ? { searchTag: initParams.searchTag } : {}),
          ...(typeof initParams.searchDomain === 'string' ? { searchDomain: initParams.searchDomain } : {}),
        };
      } else {
        pendingNavParams = null;
      }
    },
    async load() {
      if (!container) return;

      _isMounted = true;
      // Pre-fetch paint at today's position (before the initial fetch
      // resolves). The subscription refresh() calls below then paint results.
      // First call takes the View's full-build path (no shell mounted yet).
      refresh();

      // Pending pages render into the shell's dedicated region (PBI-P) and
      // live-update through the chrome.storage.onChanged subscription.
      subscribePendingStorage();
      void loadPending();

      // Single navigation entry point: filter branch → fallback check →
      // persisted sort → initial fetch (retry with backoff) all run inside
      // the Model, which owns the order.
      const navParams = pendingNavParams;
      pendingNavParams = null;
      await model.onNavigateIn(navParams ?? undefined);

      // Re-apply dynamic regions (tag badge, fallback notice, counts) onto
      // the shell: notify-driven refreshes during onNavigateIn ran against
      // the pre-fetch shell, and rebuilding here would drop them.
      // view.render() takes the diff path since the shell is mounted.
      refresh();
    },
    destroy() {
      if (searchDebounceTimer !== null) {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = null;
      }
      _isMounted = false;
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      if (unsubscribePendingStorage) {
        unsubscribePendingStorage();
        unsubscribePendingStorage = null;
      }
      pendingPages = [];
      // Single navigation exit point: generation bump + persist flush +
      // cache clear + selection clear run inside the Model.
      // (Also clears bulk bar listener references via the selection clear.)
      model.onNavigateOut();
    },
  };
}
