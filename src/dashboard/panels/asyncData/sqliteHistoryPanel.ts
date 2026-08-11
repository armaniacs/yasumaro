import {
  toggleStar,
  deleteLog,
  getSqliteStatus,
  appendToLogs,
} from '../../dashboardSqliteService.js';
import { getMessageOr } from '../../../utils/i18n.js';
import {
  queryHistory,
  isServiceError,
  dateRangeFromSelectedDate,
} from './sqliteHistoryQuery.js';
import type { BrowsingLogEntry, UnifiedHistoryQueryResult } from './sqliteHistoryQuery.js';
import { showConfirmDialog } from '../../utils/confirmDialog.js';
import { retryWithExponentialBackoff } from '../../utils/retry.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { formatEntryToMarkdown } from '../../../utils/markdownFormatter.js';
import { copyTextToClipboard } from '../../../utils/clipboard.js';
import { parseTagsForDisplay } from '../../../utils/tagUtils.js';
import { isSecureUrl } from '../../../utils/urlUtils.js';
import { type AsyncDataPanel } from '../types.js';
import { getPluralKey } from '../../../utils/i18nPlural.js';
import { escapeHtml } from '../../../utils/htmlEscape.js';
import {
  createInitialHistoryState,
  historyStateReducer,
  type SqliteHistoryState,
} from './sqliteHistoryPanelState.js';

const PAGE_SIZE = 20;

function t(key: string, substitutions?: string | string[]): string {
  return getMessageOr(key, key, substitutions);
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildCleansingProgressBarHtml(entry: BrowsingLogEntry): string {
  const base = entry.page_bytes;
  const sentToAI = (entry.fallback_triggered ?? 0)
    ? (entry.cleansed_bytes ?? entry.original_bytes)
    : (entry.ai_summary_cleansed_bytes ?? entry.ai_summary_original_bytes ?? entry.cleansed_bytes ?? entry.original_bytes);

  if (base == null || sentToAI == null || base === 0) return '';

  const sentRatio = Math.min(sentToAI / base, 1);
  const reductionRate = Math.min((1 - sentRatio) * 100, 99.9);

  const formatBytes = (b: number): string => {
    if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
    if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${b} B`;
  };

  const label = `${formatBytes(base)} → ${formatBytes(sentToAI)} (${reductionRate.toFixed(1)}% ${t('cleansingReduction')})`;

  return `<div class="cleansing-progress-wrapper">
    <div class="cleansing-progress"><div class="cleansing-progress-bar" data-bar-width="${Math.max(sentRatio * 100, 0.2).toFixed(1)}"></div></div>
    <span class="cleansing-progress-label">${escapeHtml(label)}</span>
  </div>`;
}

export function formatDiagnosticMetadataHtml(entry: BrowsingLogEntry): string {
  const parts: string[] = [];

  if (entry.summary && entry.summary.trim().length > 0) {
    parts.push(`<div class="history-entry-ai-summary">${escapeHtml(entry.summary)}</div>`);
  }

  if (entry.sent_tokens != null || entry.received_tokens != null) {
    const tokenParts: string[] = [];
    if (entry.sent_tokens != null) tokenParts.push(`<span class="token-label">${t('historySentTokens', [''])}:</span> <span class="token-value">${entry.sent_tokens}</span>`);
    if (entry.received_tokens != null) tokenParts.push(`<span class="token-label">${t('historyReceivedTokens', [''])}:</span> <span class="token-value">${entry.received_tokens}</span>`);
    let tokensText = `${t('historyTokens', [])}: ${tokenParts.join(', ')}`;
    if (entry.ai_duration_ms != null && entry.ai_duration_ms > 0) {
      tokensText += `, ${t('historyDuration', [])} ${(entry.ai_duration_ms / 1000).toFixed(1)}秒`;
    }
    if (entry.ai_provider) {
      const aiParts = [escapeHtml(entry.ai_provider)];
      if (entry.ai_model) aiParts.push(escapeHtml(entry.ai_model));
      tokensText += ` (AI: ${aiParts.join(' / ')})`;
    }
    parts.push(`<div class="history-entry-tokens">${tokensText}</div>`);
  } else if (entry.ai_provider) {
    const aiParts = [escapeHtml(entry.ai_provider)];
    if (entry.ai_model) aiParts.push(escapeHtml(entry.ai_model));
    let providerText = `AI: ${aiParts.join(' / ')}`;
    if (entry.ai_duration_ms != null && entry.ai_duration_ms > 0) {
      providerText += `, ${t('historyDuration', [])} ${(entry.ai_duration_ms / 1000).toFixed(1)}秒`;
    }
    parts.push(`<div class="history-entry-tokens">${providerText}</div>`);
  }

  if (entry.page_bytes != null && entry.candidate_bytes != null) {
    const reduction = entry.page_bytes - entry.candidate_bytes;
    const reductionPercent = ((reduction / entry.page_bytes) * 100).toFixed(1);
    parts.push(`<div class="history-entry-token-reduction">${t('historyContentExtraction', [])} — ${t('historyBytes', [])}: ${entry.page_bytes} → ${entry.candidate_bytes} (${t('historyReduction', [])} ${reduction} / ${reductionPercent}%)</div>`);
  }

  if (entry.original_bytes != null || entry.cleansed_bytes != null) {
    const contentOriginalB = (entry.original_bytes || entry.candidate_bytes) as number | null | undefined;
    const contentCleansedB = (entry.cleansed_bytes || entry.original_bytes || entry.candidate_bytes) as number | null | undefined;
    if (contentOriginalB != null && contentCleansedB != null) {
      const reduction = contentOriginalB - contentCleansedB;
      const reductionPercent = contentOriginalB > 0 ? ((reduction / contentOriginalB) * 100).toFixed(1) : '0.0';
      parts.push(`<div class="history-entry-token-reduction">${t('historyContentCleansing', [])} — ${t('historyBytes', [])}: ${contentOriginalB} → ${contentCleansedB} (${t('historyReduction', [])} ${reduction} / ${reductionPercent}%)</div>`);
    }
  }

  if (entry.masked_count != null || (entry.original_tokens != null && entry.cleansed_tokens != null)) {
    const maskingParts: string[] = [];
    if (entry.masked_count != null) {
      maskingParts.push(`${t('historyMaskedCount', [])}: ${entry.masked_count}`);
    }
    if (entry.original_tokens != null && entry.cleansed_tokens != null) {
      maskingParts.push(`${t('historyTokens', [])}: ${entry.original_tokens} → ${entry.cleansed_tokens}`);
    }
    if (maskingParts.length > 0) {
      parts.push(`<div class="history-entry-token-reduction">${t('historyPiiMasking', [])} — ${maskingParts.join(', ')}</div>`);
    }
  }

  if (entry.ai_summary_original_bytes != null && entry.ai_summary_cleansed_bytes != null) {
    const reduction = entry.ai_summary_original_bytes - entry.ai_summary_cleansed_bytes;
    const reductionPercent = entry.ai_summary_original_bytes > 0 ? ((reduction / entry.ai_summary_original_bytes) * 100).toFixed(1) : '0.0';
    parts.push(`<div class="history-entry-ai-summary-cleansing">${t('historyAiSummaryCleansing', [])}: ${entry.ai_summary_original_bytes} → ${entry.ai_summary_cleansed_bytes} (${t('historyReduction', [])} ${reduction} / ${reductionPercent}%)</div>`);
  }

  const progressBarHtml = buildCleansingProgressBarHtml(entry);
  if (progressBarHtml) parts.push(progressBarHtml);

  return parts.join('');
}

export function createSqliteHistoryPanel(): AsyncDataPanel {
  let container: HTMLElement | null = null;

  let state = createInitialHistoryState();
  let requestGeneration = 0;

  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let isMounted = false;
  /**
   * Pending init parameters set by onActivate before loadData runs.
   * Used to preserve searchTag/searchDomain across the loadData lifecycle.
   */
  let pendingInit: Record<string, unknown> | null = null;

  function dateRangeFromSelected(): { since?: number; until?: number } {
    return dateRangeFromSelectedDate(state.selectedDate);
  }

  function isPanelMounted(): boolean {
    return document.getElementById('sqlite-search-input') !== null;
  }

  async function handleToggleStar(id: number): Promise<void> {
    const result = await toggleStar(id);
    if ('error' in result) {
      // Without this the click looked ignored: a failed toggle left the star
      // unchanged and showed nothing at all (PBI-21).
      state = historyStateReducer(state, { type: 'operationError', error: result.error });
      refresh();
      return;
    }
    const entry = state.entries.find(e => e.id === id);
    if (entry) {
      state = historyStateReducer(state, { type: 'toggleStarSuccess', id, starred: result.data.is_starred === 1 });
    }
    refresh();
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
    const result = await deleteLog(id);
    if ('error' in result) {
      // The entry stays in the list — removing it would claim a delete that
      // did not happen.
      state = historyStateReducer(state, { type: 'operationError', error: result.error });
      refresh();
      return;
    }
    state = historyStateReducer(state, { type: 'deleteSuccess', id });
    refresh();
  }

  function createCopyButton(entry: BrowsingLogEntry): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'history-copy-btn sqlite-entry-copy';
    button.setAttribute('aria-label', t('copyMarkdown') || 'Copy Markdown');
    const originalIcon = '\u{1F4CB}';
    button.textContent = originalIcon;
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const markdown = formatEntryToMarkdown(entry);
        await copyTextToClipboard(markdown);
        button.textContent = '\u2713';
        button.setAttribute('aria-label', t('copyMarkdownSuccess') || 'Copied to clipboard');
        setTimeout(() => {
          button.textContent = originalIcon;
          button.setAttribute('aria-label', t('copyMarkdown') || 'Copy Markdown');
          button.disabled = false;
        }, 2000);
      } catch {
        button.textContent = '\u2717';
        button.setAttribute('aria-label', t('copyMarkdownFail') || 'Failed to copy');
        setTimeout(() => {
          button.textContent = originalIcon;
          button.setAttribute('aria-label', t('copyMarkdown') || 'Copy Markdown');
          button.disabled = false;
        }, 2000);
      }
    });
    return button;
  }

  function updateBulkBar(
    selectedIds: Set<number>,
    entries: BrowsingLogEntry[],
  ): void {
    const bar = document.getElementById('sqlite-bulk-bar');
    const selectAll = document.getElementById('sqlite-select-all') as HTMLInputElement | null;
    const countEl = document.getElementById('sqlite-selection-count');
    const appendBtn = document.getElementById('sqlite-append-obsidian') as HTMLButtonElement | null;

    if (bar) {
      bar.style.display = selectedIds.size > 0 ? '' : 'none';
    }

    if (selectAll) {
      selectAll.checked = entries.length > 0 && selectedIds.size === entries.length;
    }

    if (countEl) {
      countEl.textContent = t('historySelectionCount', [String(selectedIds.size)]);
    }

    if (appendBtn) {
      appendBtn.disabled = selectedIds.size === 0;
    }
  }

  async function handleAppendToObsidian(): Promise<void> {
    if (state.selectedIds.size === 0) return;

    const ids = Array.from(state.selectedIds);
    const result = await appendToLogs(ids);

    if ('data' in result) {
      state.selectedIds.clear();
      refresh();
      chrome.notifications?.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('/icons/icon48.png'),
        title: t('historyAppendToObsidian'),
        message: t(getPluralKey('historyAppendSuccess', ids.length), [String(ids.length)]),
      });
      return;
    }

    // "Obsidian not configured" used to be the only failure message shown,
    // covering both that case and every other reason alike; the reason from
    // the response is now available and worth showing instead of guessing.
    chrome.notifications?.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('/icons/icon48.png'),
      title: t('historyAppendToObsidian'),
      message: `${t('historyAppendFailed')}: ${result.error}`,
    });
  }

  function handleSearch(query: string): void {
    state = historyStateReducer(state, { type: 'search', query });
    if (query.trim()) {
      fetchData({ search: query.trim() });
    } else {
      fetchData({ page: 0 });
    }
  }

  async function handleDateSelect(dateStr: string): Promise<void> {
    state = historyStateReducer(state, { type: 'dateSelect', date: dateStr });

    const date = new Date(dateStr + 'T00:00:00');
    const since = date.getTime();
    const until = date.getTime() + 86400000 - 1;

    await fetchData({ since, until });
  }

  function handleContentToggle(controlsId: string): void {
    const area = document.getElementById(controlsId);
    if (!area) return;
    const isHidden = area.classList.toggle('hidden');
    const btn = document.querySelector(`[aria-controls="${controlsId}"]`) as HTMLButtonElement | null;
    if (!btn) return;
    btn.setAttribute('aria-expanded', String(!isHidden));
    if (controlsId.startsWith('content-sent-')) {
      btn.textContent = isHidden ? (t('historyShowSentData') || 'AI\u306B\u9001\u4FE1\u3057\u305F\u30C7\u30FC\u30BF') : (t('historyHideSentData') || '\u30C7\u30FC\u30BF\u3092\u975E\u8868\u793A');
    } else if (controlsId.startsWith('content-received-')) {
      btn.textContent = isHidden ? (t('historyShowReceivedData') || 'AI\u304B\u3089\u53D7\u4FE1\u3057\u305F\u30C7\u30FC\u30BF') : (t('historyHideReceivedData') || '\u30C7\u30FC\u30BF\u3092\u975E\u8868\u793A');
    } else {
      btn.textContent = isHidden ? t('historyShowContent') : t('historyHideContent');
    }
  }

  const bulkCallbacks = {
    onSelectAll: (checked: boolean) => {
      if (checked) {
        state.entries.forEach(e => state.selectedIds.add(e.id));
      } else {
        state.selectedIds.clear();
      }
      updateBulkBar(state.selectedIds, state.entries);
    },
    onClear: () => {
      state.selectedIds.clear();
      updateBulkBar(state.selectedIds, state.entries);
    },
    onAppend: () => {
      void handleAppendToObsidian();
    },
  };

  function reloadCurrent(): void {
    if (state.searchQuery.trim()) {
      void fetchData({ search: state.searchQuery, page: state.currentPage });
    } else {
      void fetchData({ ...dateRangeFromSelected(), page: state.currentPage });
    }
  }

  async function fetchData(options: {
    limit?: number;
    since?: number;
    until?: number;
    search?: string;
    page?: number;
    tagFilter?: string;
    tagInitiated?: boolean;
  } = {}): Promise<void> {
    const generation = ++requestGeneration;
    state = historyStateReducer(state, { type: 'loadStart' });
    refresh();

    try {
      const page = Math.max(0, options.page ?? state.currentPage);
      const limit = PAGE_SIZE;
      const offset = page * limit;

      const activeTagFilter = options.tagFilter !== undefined ? options.tagFilter : state.activeTagFilter;

      // All storage knowledge — SQLite paging/search plus legacy
      // chrome.storage enrichment — lives in the unified history query module.
      const result: UnifiedHistoryQueryResult = await queryHistory({
        search: options.search,
        since: options.since,
        until: options.until,
        limit,
        offset,
        tagFilter: activeTagFilter || undefined,
        tagInitiated: options.tagInitiated,
      });

      if (generation !== requestGeneration) return;

      if (isServiceError(result)) {
        state = historyStateReducer(state, { type: 'loadFailure', error: t('historyLoadError') });
      } else {
        const data = result.data;
        state = historyStateReducer(state, { type: 'loadSuccess', data });
      }
    } catch (err) {
      if (generation !== requestGeneration) return;
      state = historyStateReducer(state, { type: 'loadFailure', error: `Error: ${errorMessage(err)}` });
    } finally {
      if (generation === requestGeneration) {
        state = { ...state, loading: false };
        refresh();
        refreshTagFallbackNotice();
      }
    }
  }

  function clearTagFilterAndReload(): void {
    const hadFallback = state.pendingTagFallback !== null;
    state = historyStateReducer(state, { type: 'clearTagFilter' });
    if (hadFallback && state.searchQuery) state = historyStateReducer(state, { type: 'search', query: '' });
    void fetchData({ page: 0, ...dateRangeFromSelected() });
  }

  function updateTagFilterBar(
    containerEl: HTMLElement,
    activeTagFilter: string | null,
    pendingTagFallback: SqliteHistoryState['pendingTagFallback'],
    onClear: () => void,
  ): void {
    const existingBar = containerEl.querySelector('#sqlite-tag-filter-bar') as HTMLElement | null;
    if (activeTagFilter || pendingTagFallback) {
      if (!existingBar) {
        const bar = document.createElement('div');
        bar.id = 'sqlite-tag-filter-bar';
        bar.className = 'sqlite-tag-filter-bar';
        bar.setAttribute('role', 'status');
        bar.innerHTML = `
          <span data-i18n="tagFilterLabel">\u30D5\u30A3\u30EB\u30BF\u30FC:</span>
           <span class="tag-filter-badge">#${escapeHtml(activeTagFilter || pendingTagFallback?.tag || '')}</span>
          <button type="button" id="sqlite-tag-filter-clear" class="tag-filter-clear" aria-label="${t('clearTagFilter') || 'Clear tag filter'}">\u2715</button>`;
        containerEl.appendChild(bar);
        const clearBtn = bar.querySelector('#sqlite-tag-filter-clear') as HTMLButtonElement | null;
        if (clearBtn) {
          clearBtn.addEventListener('click', onClear);
        }
      }
    } else {
      if (existingBar) {
        existingBar.remove();
      }
    }

    // Fallback notice: shown when a tag-initiated navigation matched nothing
    // and we switched to a full-text search for the same term.
    const existingNote = containerEl.querySelector('.sqlite-tag-fallback-note') as HTMLElement | null;
    if (pendingTagFallback) {
      if (!existingNote) {
        const note = document.createElement('div');
        note.className = 'sqlite-tag-fallback-note';
        note.setAttribute('role', 'status');
        note.textContent = t('tagFallbackNotice', [
          pendingTagFallback.tag,
          pendingTagFallback.fallbackTo,
          String(pendingTagFallback.matched),
        ]);
        containerEl.appendChild(note);
      }
    } else {
      if (existingNote) {
        existingNote.remove();
      }
    }
  }

  function updateDynamicRegions(): void {
    const countEl = container?.querySelector('.sqlite-history-count');
    if (countEl) countEl.textContent = t(getPluralKey('historyRecordCount', state.total), [String(state.total)]);

    // Keep the search input value in sync with state.searchQuery, which may
    // have been set by a tag-fallback full-text search or cleared by a filter
    // action.  Without this, the input stays stale after non-renderState
    // refresh paths (updateDynamicRegions).
    const searchInputEl = document.getElementById('sqlite-search-input') as HTMLInputElement | null;
    if (searchInputEl && searchInputEl.value !== state.searchQuery) {
      searchInputEl.value = state.searchQuery;
    }

    const errorEl = document.getElementById('sqlite-error');
    if (errorEl) {
      errorEl.textContent = state.error || '';
      (errorEl as HTMLElement).style.display = state.error ? '' : 'none';
    }

    const searchArea = container?.querySelector('.sqlite-history-search');
    if (searchArea) {
      updateTagFilterBar(
        searchArea as HTMLElement,
        state.activeTagFilter,
        state.pendingTagFallback,
        clearTagFilterAndReload,
      );
    }

    const calContainer = document.getElementById('sqlite-calendar-nav');
    if (calContainer) {
      renderCalendarNav(calContainer, state.selectedDate,
        { searchQuery: state.searchQuery, activeTagFilter: state.activeTagFilter },
        {
          onDateSelect: (d) => void handleDateSelect(d),
          onRangeSelect: (since, until) => { state.selectedDate = null; state.searchQuery = ''; state.pendingTagFallback = null; state.currentPage = 0; void fetchData({ since, until }); },
          onClearFilters: () => { state.searchQuery = ''; state.selectedDate = null; state.activeTagFilter = null; state.pendingTagFallback = null; state.currentPage = 0; void fetchData(); },
        }
      );
    }

    const listContainer = document.getElementById('sqlite-entry-list');
    if (listContainer) {
      if (state.loading) {
        listContainer.innerHTML = `<div class="loading">${t('historyLoading')}</div>`;
      } else {
        renderEntryList(listContainer, state.entries, state.selectedIds, state.activeTagFilter, {
          onToggleStar: (id) => void handleToggleStar(id),
          onDelete: (id) => void handleDelete(id),
          onSelectionChange: (id, selected) => { if (selected) state.selectedIds.add(id); else state.selectedIds.delete(id); updateBulkBar(state.selectedIds, state.entries); },
          onTagFilterClick: (tag) => { state.activeTagFilter = state.activeTagFilter === tag ? null : tag; state.currentPage = 0; void fetchData({ tagFilter: state.activeTagFilter || undefined, ...dateRangeFromSelected() }); },
          onContentToggle: (controlsId) => handleContentToggle(controlsId),
        });
      }
    }

    if (!state.loading) {
      const pagContainer = document.getElementById('sqlite-pagination');
      if (pagContainer) renderPagination(pagContainer, state.currentPage, state.total, PAGE_SIZE, (page) => { state.currentPage = page; reloadCurrent(); });
    }

    updateBulkBar(state.selectedIds, state.entries);
  }

  const debouncedSearch = (() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (query: string) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        handleSearch(query);
        timer = null;
      }, 300);
      searchDebounceTimer = timer;
    };
  })();

  function renderEntryList(
    _container: HTMLElement,
    entries: BrowsingLogEntry[],
    selectedIds: Set<number>,
    activeTagFilter: string | null,
    callbacks: {
      onToggleStar: (id: number) => void;
      onDelete: (id: number) => void;
      onSelectionChange: (id: number, selected: boolean) => void;
      onTagFilterClick: (tag: string) => void;
      onContentToggle: (controlsId: string) => void;
    }
  ): void {
    const displayEntries = entries;

    if (displayEntries.length === 0) {
      _container.innerHTML = `<div class="empty-state">${t('historyNoRecords')}</div>`;
      return;
    }

    _container.innerHTML = displayEntries.map(entry => {
      const entryTags = parseTagsForDisplay(entry.tags);
      const tagsHtml = entryTags.length > 0
        ? `<div class="sqlite-entry-tags">${entryTags.map(tag => {
            const isActive = activeTagFilter === tag;
            return `<button type="button" class="tag-badge${isActive ? ' filter-active' : ''}"
              data-tag="${escapeHtml(tag)}"
              data-action="tag-filter"
              aria-pressed="${isActive ? 'true' : 'false'}">#${escapeHtml(tag)}</button>`;
          }).join('')}</div>`
        : '';

      const diagnosticMetadataHtml = formatDiagnosticMetadataHtml(entry);

      return `
      <div class="sqlite-entry" data-id="${entry.id}">
        <div class="sqlite-entry-header">
          <input type="checkbox" class="sqlite-entry-checkbox" data-action="select"
                 data-id="${entry.id}" ${selectedIds.has(entry.id) ? 'checked' : ''}
                 aria-label="${t('historySelectRecord')}">
          <button type="button" class="sqlite-entry-star ${entry.is_starred ? 'starred' : ''}"
                  data-action="star" title="${t('historyToggleStar')}"
                   aria-pressed="${String(Boolean(entry.is_starred))}" aria-label="${t('historyToggleStar')}">\u2605</button>
          <a href="${isSecureUrl(entry.url) ? escapeHtml(entry.url) : '#'}" target="_blank" rel="noopener noreferrer" class="sqlite-entry-title">
            ${escapeHtml(entry.title || entry.url)}
          </a>
          <button type="button" class="sqlite-entry-delete" data-action="delete" title="${t('historyDeleteRecord')}" aria-label="${t('historyDeleteRecordAria')}">\u2715</button>
        </div>
        <div class="sqlite-entry-meta">
          <span class="sqlite-entry-domain">${escapeHtml(entry.domain || '')}</span>
          <span class="sqlite-entry-time">${formatTimestamp(entry.created_at)}</span>
        </div>
        ${diagnosticMetadataHtml ? `<div class="sqlite-entry-diagnostics">${diagnosticMetadataHtml}</div>` : ''}
        ${entry.content != null ? `
          <button type="button" class="content-toggle-btn" data-action="content-toggle"
                  data-id="${entry.id}" aria-expanded="false" aria-controls="content-sent-${entry.id}">
            ${t('historyShowSentData') || 'AI\u306B\u9001\u4FE1\u3057\u305F\u30C7\u30FC\u30BF'}
          </button>
          <div class="content-preview hidden" id="content-sent-${entry.id}">${escapeHtml(entry.content)}</div>
        ` : ''}
        ${entry.summary != null && entry.summary.trim().length > 0 ? `
          <button type="button" class="content-toggle-btn" data-action="content-toggle"
                  data-id="${entry.id}" aria-expanded="false" aria-controls="content-received-${entry.id}">
            ${t('historyShowReceivedData') || 'AI\u304B\u3089\u53D7\u4FE1\u3057\u305F\u30C7\u30FC\u30BF'}
          </button>
          <div class="content-preview hidden" id="content-received-${entry.id}">${escapeHtml(entry.summary)}</div>
        ` : ''}
        ${tagsHtml}
      </div>`;
    }).join('');

    // Set progress bar widths from data attributes (CSP-safe: no inline styles)
    _container.querySelectorAll<HTMLElement>('.cleansing-progress-bar[data-bar-width]').forEach((bar) => {
      bar.style.width = `${bar.getAttribute('data-bar-width')}%`;
    });

    _container.querySelectorAll('[data-action="select"]').forEach((el) => {
      const id = Number((el as HTMLElement).getAttribute('data-id'));
      el.addEventListener('change', () => {
        const checkbox = el as HTMLInputElement;
        callbacks.onSelectionChange(id, checkbox.checked);
      });
    });
    _container.querySelectorAll('[data-action="star"]').forEach((el) => {
      const entryId = Number((el as HTMLElement).closest('.sqlite-entry')?.getAttribute('data-id'));
      if (entryId) el.addEventListener('click', () => callbacks.onToggleStar(entryId));
    });
    _container.querySelectorAll('[data-action="delete"]').forEach((el) => {
      const entryId = Number((el as HTMLElement).closest('.sqlite-entry')?.getAttribute('data-id'));
      if (entryId) el.addEventListener('click', () => callbacks.onDelete(entryId));
    });

    displayEntries.forEach(entry => {
      const entryEl = _container.querySelector(`.sqlite-entry[data-id="${entry.id}"] .sqlite-entry-header`);
      if (entryEl) {
        entryEl.appendChild(createCopyButton(entry));
      }
    });

    _container.querySelectorAll('[data-action="content-toggle"]').forEach((el) => {
      el.addEventListener('click', () => {
        const controlsId = el.getAttribute('aria-controls');
        if (!controlsId) return;
        callbacks.onContentToggle(controlsId);
      });
    });

    _container.querySelectorAll('[data-action="tag-filter"]').forEach((el) => {
      el.addEventListener('click', () => {
        const tag = (el as HTMLElement).getAttribute('data-tag');
        if (!tag) return;
        callbacks.onTagFilterClick(tag);
      });
    });
  }

  function renderPagination(
    _container: HTMLElement,
    currentPage: number,
    total: number,
    pageSize: number,
    onPageChange: (page: number) => void
  ): void {
    const totalPages = Math.ceil(total / pageSize);
    if (totalPages <= 1) {
      _container.innerHTML = '';
      return;
    }

    _container.innerHTML = `
      <button ${currentPage === 0 ? 'disabled' : ''} data-page="prev">${t('historyPrev')}</button>
      <span>${t('historyPageInfo', [String(currentPage + 1), String(totalPages)])}</span>
      <button ${currentPage >= totalPages - 1 ? 'disabled' : ''} data-page="next">${t('historyNext')}</button>
    `;

    _container.querySelector('[data-page="prev"]')?.addEventListener('click', () => onPageChange(currentPage - 1));
    _container.querySelector('[data-page="next"]')?.addEventListener('click', () => onPageChange(currentPage + 1));
  }

  function renderCalendarNav(
    _container: HTMLElement,
    selectedDate: string | null,
    options: { searchQuery: string; activeTagFilter: string | null },
    callbacks: {
      onDateSelect: (d: string) => void;
      onRangeSelect: (since: number, until: number) => void;
      onClearFilters: () => void;
    }
  ): void {
    const now = new Date();
    const currentMonth = selectedDate
      ? new Date(selectedDate + 'T00:00:00')
      : now;

    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();

    const hasActiveFilters = Boolean(options.searchQuery.trim()) || selectedDate != null || options.activeTagFilter != null;

    _container.innerHTML = `
      <div class="sqlite-calendar-quick">
        <button data-date="${formatDate(now)}">${t('historyToday')}</button>
        <button data-date="${formatDate(new Date(now.getTime() - 86400000))}">${t('historyYesterday')}</button>
        <button data-date="${formatDate(now)}" data-range="7">${t('historyLast7Days')}</button>
        <button data-date="${formatDate(now)}" data-range="30">${t('historyLast30Days')}</button>
        ${hasActiveFilters ? `<button type="button" id="sqlite-clear-all-filters" class="sqlite-clear-filters-btn" aria-label="${t('clearAllFilters') || 'Clear all filters'}">${t('clearAllFilters') || '\u6761\u4EF6\u3092\u30AF\u30EA\u30A2'}</button>` : ''}
      </div>
      <div class="sqlite-calendar-month">
        <button data-month-prev>&lt;</button>
        <span>${year}-${String(month + 1).padStart(2, '0')}</span>
        <button data-month-next>&gt;</button>
      </div>
      <div class="sqlite-calendar-days" id="sqlite-calendar-days"></div>
    `;

    _container.querySelectorAll('[data-date]').forEach(el => {
      el.addEventListener('click', () => {
        const date = (el as HTMLElement).dataset.date!;
        const range = (el as HTMLElement).dataset.range;
        if (range) {
          const d = new Date(date + 'T00:00:00');
          const since = d.getTime() - (Number(range) * 86400000);
          callbacks.onRangeSelect(since, d.getTime() + 86400000 - 1);
        } else {
          callbacks.onDateSelect(date);
        }
      });
    });

    _container.querySelector('[data-month-prev]')?.addEventListener('click', () => {
      const d = new Date(year, month - 1, 1);
      callbacks.onDateSelect(formatDate(d));
    });
    _container.querySelector('[data-month-next]')?.addEventListener('click', () => {
      const d = new Date(year, month + 1, 1);
      callbacks.onDateSelect(formatDate(d));
    });

    _container.querySelector('#sqlite-clear-all-filters')?.addEventListener('click', () => {
      const searchInput = document.getElementById('sqlite-search-input') as HTMLInputElement | null;
      if (searchInput) searchInput.value = '';
      callbacks.onClearFilters();
    });

    const daysEl = _container.querySelector('#sqlite-calendar-days');
    if (!daysEl) return;

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDay = new Date(year, month, 1).getDay();

    let daysHtml = '';
    for (let i = 0; i < firstDay; i++) {
      daysHtml += '<span class="day empty" aria-hidden="true"></span>';
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isSelected = dateStr === selectedDate;
      const isToday = dateStr === formatDate(now);
      const dateLabel = `${year}${t('historyDateYear')}${month + 1}${t('historyDateMonth')}${d}${t('historyDateDay')}`;
      daysHtml += `<button type="button" class="day${isSelected ? ' selected' : ''}${isToday ? ' today' : ''}"
        data-date="${dateStr}" aria-pressed="${isSelected}" aria-label="${dateLabel}">${d}</button>`;
    }
    daysEl.innerHTML = daysHtml;

    daysEl.querySelectorAll('.day:not(.empty)').forEach(el => {
      el.addEventListener('click', () => {
        callbacks.onDateSelect((el as HTMLElement).dataset.date!);
      });
    });
  }

  function renderState(): void {
    if (!container) return;

    const fallbackBanner = state.fallbackMode
      ? `<div class="sqlite-fallback-warning warning-banner" role="alert">
          \u26A0\uFE0F ${t('fallbackStorageWarning')}
         </div>`
      : '';

    container.innerHTML = `
      ${fallbackBanner}
      <div class="sqlite-history-header">
        <h3 data-i18n="sqliteHistoryTitle">SQLite History</h3>
        <span class="sqlite-history-count">${t(getPluralKey('historyRecordCount', state.total), [String(state.total)])}</span>
      </div>
      <div class="sqlite-history-search">
        <input type="text" id="sqlite-search-input"
          placeholder="${t('historySearchPlaceholder')}"
          value="${escapeHtml(state.searchQuery)}"
          aria-label="${t('historySearchAriaLabel')}" />
        <div id="sqlite-calendar-nav" class="sqlite-calendar-nav"></div>
        <div id="sqlite-error" class="sqlite-history-error${state.error ? '' : ' hidden'}">
          ${escapeHtml(state.error || '')}
        </div>
      </div>
      <div id="sqlite-bulk-bar" class="sqlite-bulk-bar${state.selectedIds.size > 0 ? '' : ' hidden'}">
        <label class="sqlite-bulk-select-all">
          <input type="checkbox" id="sqlite-select-all" aria-label="${t('historySelectAll')}">
          <span data-i18n="historySelectAll">${t('historySelectAll')}</span>
        </label>
        <button type="button" id="sqlite-clear-selection" class="secondary-btn" data-i18n="historyClearSelection">${t('historyClearSelection')}</button>
        <span id="sqlite-selection-count" class="sqlite-selection-count" aria-live="polite">${t('historySelectionCount', [String(state.selectedIds.size)])}</span>
        <button type="button" id="sqlite-append-obsidian" class="btn-primary" data-i18n="historyAppendToObsidian">${t('historyAppendToObsidian')}</button>
      </div>
      <div id="sqlite-entry-list" class="sqlite-entry-list">
        ${state.loading ? `<div class="loading">${t('historyLoading')}</div>` : ''}
      </div>
      <div id="sqlite-pagination" class="sqlite-pagination"></div>
    `;

    if (!state.loading) {
      const calContainer = document.getElementById('sqlite-calendar-nav');
      if (calContainer) {
        renderCalendarNav(calContainer, state.selectedDate,
          { searchQuery: state.searchQuery, activeTagFilter: state.activeTagFilter },
          {
            onDateSelect: (d) => void handleDateSelect(d),
            onRangeSelect: (since, until) => { state.selectedDate = null; state.searchQuery = ''; state.pendingTagFallback = null; state.currentPage = 0; void fetchData({ since, until }); },
            onClearFilters: () => { state.searchQuery = ''; state.selectedDate = null; state.activeTagFilter = null; state.pendingTagFallback = null; state.currentPage = 0; void fetchData(); },
          }
        );
      }

      const listContainer = document.getElementById('sqlite-entry-list');
      if (listContainer) {
        renderEntryList(listContainer, state.entries, state.selectedIds, state.activeTagFilter, {
          onToggleStar: (id) => void handleToggleStar(id),
          onDelete: (id) => void handleDelete(id),
          onSelectionChange: (id, selected) => { if (selected) state.selectedIds.add(id); else state.selectedIds.delete(id); updateBulkBar(state.selectedIds, state.entries); },
          onTagFilterClick: (tag) => { state.activeTagFilter = state.activeTagFilter === tag ? null : tag; state.currentPage = 0; void fetchData({ tagFilter: state.activeTagFilter || undefined, ...dateRangeFromSelected() }); },
          onContentToggle: (controlsId) => handleContentToggle(controlsId),
        });
      }

      const pagContainer = document.getElementById('sqlite-pagination');
      if (pagContainer) renderPagination(pagContainer, state.currentPage, state.total, PAGE_SIZE, (page) => { state.currentPage = page; reloadCurrent(); });
    }

    const searchInput = document.getElementById('sqlite-search-input') as HTMLInputElement;
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        debouncedSearch(searchInput.value);
      });
      searchInput.focus();
    }

    const selectAllCheckbox = document.getElementById('sqlite-select-all') as HTMLInputElement | null;
    const clearSelectionBtn = document.getElementById('sqlite-clear-selection') as HTMLButtonElement | null;
    const appendBtn = document.getElementById('sqlite-append-obsidian') as HTMLButtonElement | null;

    if (selectAllCheckbox) {
      selectAllCheckbox.checked = state.selectedIds.size > 0 && state.selectedIds.size === state.entries.length;
      selectAllCheckbox.addEventListener('change', () => {
        if (selectAllCheckbox.checked) {
          state.entries.forEach(e => state.selectedIds.add(e.id));
        } else {
          state.selectedIds.clear();
        }
        refresh();
      });
    }

    if (clearSelectionBtn) {
      clearSelectionBtn.addEventListener('click', () => {
        state.selectedIds.clear();
        refresh();
      });
    }

    if (appendBtn) {
      appendBtn.addEventListener('click', () => void handleAppendToObsidian());
    }
  }

  function refresh(): void {
    if (isPanelMounted()) {
      updateDynamicRegions();
    } else {
      renderState();
    }
  }

  function refreshTagFallbackNotice(): void {
    const searchArea = container?.querySelector('.sqlite-history-search');
    if (!searchArea) return;
    updateTagFilterBar(
      searchArea as HTMLElement,
      state.activeTagFilter,
      state.pendingTagFallback,
      clearTagFilterAndReload,
    );
  }

  async function checkFallbackStatus(): Promise<void> {
    try {
      const status = await getSqliteStatus();
      if (status?.fallback) {
        state = historyStateReducer(state, { type: 'setFallbackMode' });
        renderState();
      }
    } catch {
      // Ignore
    }
  }

  async function retryInitialLoad(
    fetchOpts: Parameters<typeof fetchData>[0] = { limit: PAGE_SIZE },
  ): Promise<void> {
    state.loading = true;
    state.error = null;
    renderState();

    const result = await retryWithExponentialBackoff<boolean>(
      async () => {
        await fetchData(fetchOpts);
        return state.error ? null : true;
      },
      { label: 'sqliteHistory', maxAttempts: 4 }
    );

    state.loading = false;
    if (!result) {
      // Error already set by fetchData
    }
    renderState();
  }

  /**
   * Consume pending init parameters (set by onActivate before loadData runs)
   * and return the fetch options to use for the initial load.
   */
  function consumePendingInit(): Parameters<typeof fetchData>[0] | null {
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

  return {
    id: 'panel-sqlite-history',
    category: 'async-data',
    mount(c: HTMLElement) {
      container = c;
    },
    async loadData() {
      if (!container) return;

      isMounted = true;
      await checkFallbackStatus();
      renderState();

      // Consume any init params set by onActivate (which runs before loadData)
      // so retryInitialLoad uses the correct search/tag parameters.
      const fetchOpts = consumePendingInit();
      void retryInitialLoad(fetchOpts ?? { limit: PAGE_SIZE });
    },
    unmount() {
      if (searchDebounceTimer !== null) {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = null;
      }
      isMounted = false;
      requestGeneration += 1;
      // Clear bulk bar listener references
      state.selectedIds.clear();
    },
    onActivate(init) {
      if (init?.searchTag) {
        pendingInit = init;
        state = historyStateReducer(state, { type: 'tagInitiated', tag: init.searchTag as string });
        void fetchData({ page: 0, tagFilter: state.activeTagFilter || undefined, tagInitiated: true });
      } else if (init?.searchDomain) {
        pendingInit = init;
        state = historyStateReducer(state, { type: 'domainSearchInitiated', query: init.searchDomain as string });
        if (state.searchQuery.trim()) {
          void fetchData({ search: state.searchQuery.trim() });
        }
      }
    },
  };
}
