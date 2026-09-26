import { tOrKey as t } from '../../../utils/i18n.js';
import type { BrowsingLogEntry } from './sqliteHistoryQuery.js';
import { showConfirmDialog } from '../../utils/confirmDialog.js';
import { createCopyMarkdownButton } from '../../../utils/copyMarkdownButton.js';
import { type PanelLifecycle } from '../types.js';
import { getPluralKey } from '../../../utils/i18nPlural.js';
import type { SqliteHistoryState, SqliteHistoryModelDeps } from './sqliteHistoryModel.js';
import { createSqliteHistoryModel } from './sqliteHistoryModel.js';
import { notify } from '../../notificationService.js';
import { getPendingPages, removePendingPages } from '../../../utils/pendingStorage.js';
import type { PendingPage } from '../../../utils/pendingStorage.js';
import { recordPendingPage, PENDING_RECORD_TIMEOUT_ERROR } from '../../../messaging/pendingRecordGateway.js';
import { regenerateSummary, REGENERATE_TIMEOUT_ERROR } from '../../../messaging/regenerateSummaryGateway.js';
import type { RegenerateCleanseMode } from '../../../utils/aiSummaryCleaner/cleanseModeLadder.js';
import {
  formatDiagnosticMetadataHtml,
  render as renderHistoryView,
  renderPendingRegion,
  toggleContentArea,
  setEntryRegenerateBusy,
  clearEntryRegenerateError,
  showEntryRegenerateError,
  showDeleteConfirm,
  hideDeleteConfirm,
} from './sqliteHistoryPanelView.js';
import type { PendingRegionActions, SqliteHistoryViewCallbacks } from './sqliteHistoryPanelView.js';

export { formatDiagnosticMetadataHtml };

/**
 * Build the multi-line error-row detail: providers tried in order, then each
 * slot's own failure text (PBI 2026-09-22-04 follow-up — the old single-error
 * display could only ever show the LAST slot's message, e.g. built-in-ai's
 * kErrorUnknown, masking why openai/gemini failed). Pure for unit tests.
 */
export function formatRegenerateErrorDetail(
  providersTried: string[],
  slotFailures: ReadonlyArray<{ provider: string; error: string }> | undefined,
  triedLabel: string,
): string | undefined {
  const lines: string[] = [];
  if (providersTried.length > 0) {
    lines.push(`${triedLabel}: ${providersTried.join(' → ')}`);
  }
  for (const f of slotFailures ?? []) {
    lines.push(`${f.provider}: ${f.error}`);
  }
  return lines.length > 0 ? lines.join('\n') : undefined;
}

/**
 * Sentinel → i18n key mapping for REGENERATE_SUMMARY failures (PBI
 * 2026-09-22-04). Exported as a pure module-level function so unit tests can
 * pin the matrix directly; raw handler strings are never rendered — unknown
 * sentinels collapse to the generic key and Error-prefixed strings pass
 * through unchanged (same contract as translateHistoryError).
 */
export function mapRegenerateError(
  error: string | undefined,
  needsForce: boolean,
  reason?: string,
  slotFailures?: ReadonlyArray<{ provider: string; error: string }>,
): string {
  if (needsForce) return t('historyRegenerateGateBlocked');
  // The handler threads reason:'rate_limited'; match it first so the raw
  // RateLimiter message (capital 'Rate limit…') never needs case gymnastics.
  if (reason === 'rate_limited') return t('historyRegenerateErrorRateLimit');
  if (!error) return t('historyRegenerateError');
  if (error === 'invalid_url') return t('historyRegenerateErrorUrl');
  if (error === 'rate_limited' || /rate limit/i.test(error)) return t('historyRegenerateErrorRateLimit');
  if (error.startsWith('fetch_failed')) return t('historyRegenerateErrorFetch');
  if (error === REGENERATE_TIMEOUT_ERROR || error === PENDING_RECORD_TIMEOUT_ERROR) return t('historyRegenerateErrorTimeout');
  if (error === 'privacy_consent_required') return t('historyRegenerateErrorConsent');
  if (error === 'ai_failed' || error.startsWith('ai_failed:')) {
    // The monthly token quota is SHARED by every HTTP provider (one counter
    // in aiUsageTracker) — when it tripped, "try another provider" advice is
    // wrong: the next HTTP slot hits the same wall. Show the actionable
    // message instead; the per-slot detail rows still explain each failure.
    if (slotFailures?.some((f) => f.error.includes('Monthly token limit'))) {
      return t('historyRegenerateErrorMonthlyLimit');
    }
    return t('historyRegenerateErrorAi');
  }
  if (error.startsWith('Error:')) return error;
  return t('historyRegenerateError');
}

export function createSqliteHistoryPanel(deps: SqliteHistoryModelDeps = {}): PanelLifecycle {
  let container: HTMLElement | null = null;
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let _isMounted = false;

  const model = createSqliteHistoryModel(deps);
  // Panel shrinks to model.subscribe(refresh): every state change funnels
  // through view.render()'s single entry (PBI 23). The subscription is taken
  // in load() (PBI 2026-09-11-06) — see modelUnsubscribe below.
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

  // --- Regenerate AI summary (PBI 2026-09-22-04) ---------------------------
  /** Handler-local in-flight guard: repeat clicks while running are ignored. */
  const regenerateInFlight = new Set<number>();

  async function handleRegenerate(id: number, mode: RegenerateCleanseMode, force: boolean): Promise<void> {
    if (!container) return;
    if (regenerateInFlight.has(id)) return; // binding: 2件目以降は無視（AI呼び出しは1回だけ）

    const entry = state().entries.find((e) => e.id === id);
    if (!entry?.url) return;

    clearEntryRegenerateError(container, id);
    setEntryRegenerateBusy(container, id, true);
    regenerateInFlight.add(id);
    try {
      const result = await regenerateSummary({
        id,
        url: entry.url,
        title: entry.title || entry.url,
        cleanseMode: mode,
        ...(force ? { force: true } : {}),
      });

      if (result.success) {
        // Same-row UPDATE done — re-query so the row shows the new summary/
        // stats. The re-render also clears busy state.
        model.reloadCurrent();
        return;
      }

      // Cross-reload duplicate while the SW still owns the id: the panel-side
      // guard normally prevents this — stay silent instead of showing a
      // misleading failure row for what is actually "still running".
      if (result.error === 'in_flight') return;

      const needsForce = result.needsForce === true;
      const providersTried = Array.isArray(result.providersTried)
        ? result.providersTried.filter((p): p is string => typeof p === 'string')
        : [];
      const detail = formatRegenerateErrorDetail(
        providersTried,
        result.slotFailures,
        t('historyRegenerateProvidersTried'),
      );
      showEntryRegenerateError(
        container,
        id,
        mapRegenerateError(result.error, needsForce, result.reason, result.slotFailures),
        {
          ...(needsForce
            ? {
                forceLabel: t('historyRegenerateForceAction'),
                onForce: () => { void handleRegenerate(id, mode, true); },
              }
            : {}),
          ...(detail !== undefined ? { detail } : {}),
        },
      );
    } catch (e: unknown) {
      if (container) {
        showEntryRegenerateError(container, id, mapRegenerateError(e instanceof Error ? e.message : String(e), false));
      }
    } finally {
      regenerateInFlight.delete(id);
      if (container) setEntryRegenerateBusy(container, id, false);
    }
  }

  // --- Bulk actions on the checked rows -------------------------------------
  // Bulk delete is a two-step inline confirm in the bulk bar (right where
  // the eye is): first click reveals "really delete" + cancel, second click
  // executes. The shared modal dialog is intentionally not used here — it
  // renders at the document end (bottom-left, easy to miss).
  function handleDeleteSelected(): void {
    if (!container) return;
    if (state().selectedIds.size === 0) return;
    showDeleteConfirm(container);
  }

  async function handleDeleteSelectedConfirm(): Promise<void> {
    if (!container) return;
    const total = state().selectedIds.size;
    if (total === 0) {
      hideDeleteConfirm(container);
      return;
    }
    hideDeleteConfirm(container);
    const result = await model.deleteSelectedEntries();
    // The model already dispatched operationError + notify on a total failure;
    // only toast the partial/full success here. A partial run must name the
    // interruption — otherwise the leftover rows look silently kept.
    if (result.deletedCount > 0) {
      const body = result.error
        ? t('historyDeleteSelectedPartial', [
          String(result.deletedCount),
          String(total - result.deletedCount),
          translateHistoryError(result.error),
        ])
        : t(getPluralKey('historyDeleteSelectedSuccess', result.deletedCount), [String(result.deletedCount)]);
      notify(t('historyDeleteSelected'), body);
    }
  }

  /** Handler-local in-flight guard: repeat clicks while the bulk run is executing are ignored. */
  let bulkRegenerateInFlight = false;

  async function handleRegenerateSelected(): Promise<void> {
    if (bulkRegenerateInFlight) return;
    const targets = state().entries.filter(
      (e) => state().selectedIds.has(e.id) && !!e.url,
    );
    if (targets.length === 0) return;

    bulkRegenerateInFlight = true;
    try {
      let succeeded = 0;
      let failed = 0;
      let skipped = 0;
      for (const entry of targets) {
        const result = await regenerateSummary({
          id: entry.id,
          url: entry.url!,
          title: entry.title || entry.url!,
          cleanseMode: 'current',
        });
        if (result.success) {
          succeeded += 1;
        } else if (result.error !== 'in_flight') {
          // needsForce gate rejections and provider failures both land here —
          // bulk v1 has no per-item force UI, so they are counted as failed.
          failed += 1;
        } else {
          // A single-entry regenerate is already running for this row —
          // report it as skipped so succeeded + failed + skipped === targets.
          skipped += 1;
        }
      }
      notify(
        t('historyRegenerateSelected'),
        skipped > 0
          ? t('historyRegenerateSelectedResultSkipped', [String(succeeded), String(failed), String(skipped)])
          : t('historyRegenerateSelectedResult', [String(succeeded), String(failed)]),
      );
      // Re-query so every updated row shows the new summary/stats in one pass.
      await model.reloadCurrent();
    } catch (e: unknown) {
      notify(
        t('historyRegenerateSelected'),
        mapRegenerateError(e instanceof Error ? e.message : String(e), false),
      );
    } finally {
      bulkRegenerateInFlight = false;
    }
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
      onDeleteSelected: () => handleDeleteSelected(),
      onDeleteSelectedConfirm: () => void handleDeleteSelectedConfirm(),
      onRegenerateSelected: () => void handleRegenerateSelected(),
      onTagFilterClear: () => model.clearTagFilter(),
      onRegenerate: (id, mode, force) => void handleRegenerate(id, mode, force),
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

  /** Pending re-record — envelope + timeout contract lives in the shared seam (PBI 2026-09-12-01). */
  async function recordPending(url: string, skipAi: boolean): Promise<{ ok: boolean; error?: string }> {
    const page = pendingPages.find((p) => p.url === url);
    if (!page) return { ok: false, error: t('recordError') };
    const result = await recordPendingPage({ title: page.title, url: page.url, force: true, skipAi });
    if (result.success) {
      await removePendingPages([url]);
      await loadPending();
      return { ok: true };
    }
    const error = result.error === PENDING_RECORD_TIMEOUT_ERROR
      ? t('recordRequestTimedOut')
      : result.error || t('recordError');
    return { ok: false, error };
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

  // Model subscription — thin alias of former onStateChange, completes BDD happy path.
  // PBI 2026-09-11-06 (round 6): moved from creation into load() so a
  // created-but-never-loaded panel does not hold a live subscription.
  let modelUnsubscribe: (() => void) | null = null;

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
      // PBI 2026-09-11-06 (round 6): subscribe here (not at creation) — a
      // created-but-never-loaded panel must not hold a live subscription.
      if (!modelUnsubscribe) {
        modelUnsubscribe = model.subscribe(() => refresh());
      }
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
      if (modelUnsubscribe) {
        modelUnsubscribe();
        modelUnsubscribe = null;
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
