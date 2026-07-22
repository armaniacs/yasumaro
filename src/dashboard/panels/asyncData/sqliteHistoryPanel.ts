import {
  queryLogs,
  searchLogs,
  toggleStar,
  deleteLog,
  getSqliteStatus,
  appendToLogs,
} from '../../dashboardSqliteService.js';
import { getSavedUrlEntries } from '../../../utils/storageUrls.js';
import type { SavedUrlEntry } from '../../../utils/storageUrls.js';
import type { BrowsingLogEntry } from '../../dashboardSqliteService.js';
import { showConfirmDialog } from '../../utils/confirmDialog.js';
import { retryWithExponentialBackoff } from '../../utils/retry.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { formatEntryToMarkdown } from '../../../utils/markdownFormatter.js';
import { copyTextToClipboard } from '../../../utils/clipboard.js';
import { parseTagsForDisplay } from '../../../utils/tagUtils.js';
import { isSecureUrl } from '../../../utils/urlUtils.js';
import { type AsyncDataPanel } from '../types.js';
import { getRegistry } from '../registryContext.js';
import { getPluralKey } from '../../../utils/i18nPlural.js';

const PAGE_SIZE = 20;

function t(key: string, substitutions?: string | string[]): string {
  return chrome.i18n.getMessage(key, substitutions as string | string[]) || key;
}

interface SqliteHistoryState {
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
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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

function formatDiagnosticMetadataHtml(entry: BrowsingLogEntry): string {
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
      const aiParts = [entry.ai_provider];
      if (entry.ai_model) aiParts.push(entry.ai_model);
      tokensText += ` (AI: ${aiParts.join(' / ')})`;
    }
    parts.push(`<div class="history-entry-tokens">${tokensText}</div>`);
  } else if (entry.ai_provider) {
    const aiParts = [entry.ai_provider];
    if (entry.ai_model) aiParts.push(entry.ai_model);
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

  const state: SqliteHistoryState = {
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
  };

  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let isMounted = false;
  let currentEnrichmentMap: Map<string, SavedUrlEntry> | null = null;

  let chromeStorageCache: { map: Map<string, SavedUrlEntry>; builtAt: number } | null = null;
  const CHROME_STORAGE_CACHE_TTL_MS = 5000;

  async function getChromeStorageLookup(): Promise<Map<string, SavedUrlEntry> | null> {
    const now = Date.now();
    if (chromeStorageCache && (now - chromeStorageCache.builtAt) < CHROME_STORAGE_CACHE_TTL_MS) {
      return chromeStorageCache.map;
    }

    try {
      const entries = await getSavedUrlEntries();
      const map = new Map<string, SavedUrlEntry>();
      for (const entry of entries) {
        const key = `${entry.url}|${Math.floor(entry.timestamp / 60000)}`;
        map.set(key, entry);
      }
      chromeStorageCache = { map, builtAt: now };
      return map;
    } catch (err) {
      console.error('Failed to load chrome.storage entries for enrichment:', err);
      return null;
    }
  }

  function invalidateChromeStorageCache(): void {
    chromeStorageCache = null;
  }

  function enrichEntryWithChromeStorage(
    entry: BrowsingLogEntry,
    storageMap: Map<string, SavedUrlEntry>
  ): BrowsingLogEntry {
    if (entry.sent_tokens != null || entry.received_tokens != null ||
        entry.page_bytes != null || entry.ai_provider != null) {
      return entry;
    }

    const key = `${entry.url}|${Math.floor(entry.created_at / 60000)}`;
    const storageEntry = storageMap.get(key);
    if (!storageEntry) {
      return entry;
    }

    return {
      ...entry,
      content: entry.content ?? storageEntry.content ?? null,
      masked_count: entry.masked_count ?? storageEntry.maskedCount ?? null,
      cleansed_reason: entry.cleansed_reason ?? storageEntry.cleansedReason ?? null,
      ai_provider: entry.ai_provider ?? storageEntry.aiProvider ?? null,
      ai_model: entry.ai_model ?? storageEntry.aiModel ?? null,
      ai_duration_ms: entry.ai_duration_ms ?? storageEntry.aiDuration ?? null,
      obsidian_duration_ms: entry.obsidian_duration_ms ?? storageEntry.obsidianDuration ?? null,
      sent_tokens: entry.sent_tokens ?? storageEntry.sentTokens ?? null,
      received_tokens: entry.received_tokens ?? storageEntry.receivedTokens ?? null,
      original_tokens: entry.original_tokens ?? storageEntry.originalTokens ?? null,
      cleansed_tokens: entry.cleansed_tokens ?? storageEntry.cleansedTokens ?? null,
      page_bytes: entry.page_bytes ?? storageEntry.pageBytes ?? null,
      candidate_bytes: entry.candidate_bytes ?? storageEntry.candidateBytes ?? null,
      original_bytes: entry.original_bytes ?? storageEntry.originalBytes ?? null,
      cleansed_bytes: entry.cleansed_bytes ?? storageEntry.cleansedBytes ?? null,
      ai_summary_original_bytes: entry.ai_summary_original_bytes ?? storageEntry.aiSummaryOriginalBytes ?? null,
      ai_summary_cleansed_bytes: entry.ai_summary_cleansed_bytes ?? storageEntry.aiSummaryCleansedBytes ?? null,
      fallback_triggered: entry.fallback_triggered ?? (storageEntry.fallbackTriggered ? 1 : 0),
    };
  }

  function dateRangeFromSelected(): { since?: number; until?: number } {
    if (!state.selectedDate) return {};
    const date = new Date(state.selectedDate + 'T00:00:00');
    return { since: date.getTime(), until: date.getTime() + 86400000 - 1 };
  }

  function isPanelMounted(): boolean {
    return document.getElementById('sqlite-search-input') !== null;
  }

  async function handleToggleStar(id: number): Promise<void> {
    const result = await toggleStar(id);
    if (result) {
      const entry = state.entries.find(e => e.id === id);
      if (entry) entry.is_starred = result.is_starred;
      refresh();
    }
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
    const ok = await deleteLog(id);
    if (ok) {
      state.entries = state.entries.filter(e => e.id !== id);
      state.total = Math.max(0, state.total - 1);
      state.selectedIds.delete(id);
      refresh();
    }
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

    if (result === null) {
      chrome.notifications?.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('/icons/icon48.png'),
        title: t('historyAppendToObsidian'),
        message: t('historyAppendObsidianNotConfigured'),
      });
      return;
    }

    if (result.success) {
      state.selectedIds.clear();
      refresh();
      chrome.notifications?.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('/icons/icon48.png'),
        title: t('historyAppendToObsidian'),
        message: t(getPluralKey('historyAppendSuccess', ids.length), [String(ids.length)]),
      });
    } else {
      chrome.notifications?.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('/icons/icon48.png'),
        title: t('historyAppendToObsidian'),
        message: t('historyAppendFailed'),
      });
    }
  }

  function handleSearch(query: string): void {
    state.searchQuery = query;
    state.currentPage = 0;
    if (query.trim()) {
      fetchData({ search: query.trim() });
    } else {
      fetchData({ page: 0 });
    }
  }

  async function handleDateSelect(dateStr: string): Promise<void> {
    state.selectedDate = dateStr;
    state.searchQuery = '';
    state.currentPage = 0;

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
      fetchData({ search: state.searchQuery, page: state.currentPage });
    } else {
      fetchData({ ...dateRangeFromSelected(), page: state.currentPage });
    }
  }

  async function fetchData(options: {
    limit?: number;
    since?: number;
    until?: number;
    search?: string;
    page?: number;
    tagFilter?: string;
  } = {}): Promise<void> {
    state.loading = true;
    state.error = null;
    refresh();

    try {
      const page = options.page ?? state.currentPage;
      const limit = PAGE_SIZE;
      const offset = page * limit;

      let result: { rows: BrowsingLogEntry[]; total: number } | { error: string } | null;

      const activeTagFilter = options.tagFilter !== undefined ? options.tagFilter : state.activeTagFilter;

      if (options.search) {
        result = await searchLogs(options.search, limit, offset);
      } else {
        result = await queryLogs({
          limit: 1000,
          offset: 0,
          since: options.since,
          until: options.until,
          orderBy: 'created_at',
          orderDir: 'DESC',
        });

        if (result && !('error' in result) && activeTagFilter) {
          const filteredRows = result.rows.filter(row => {
            const tagsString = row.tags || '';
            if (typeof tagsString === 'string') {
              return tagsString.split(',').some(tag => tag.trim().includes(activeTagFilter));
            }
            return false;
          });
          result = {
            rows: filteredRows.slice(offset, offset + limit),
            total: filteredRows.length,
          };
        } else if (result && !('error' in result)) {
          result = {
            rows: result.rows.slice(offset, offset + limit),
            total: result.total,
          };
        }
      }

      if (result === null) {
        state.error = t('historyLoadError');
        state.entries = [];
        state.total = 0;
      } else if ('error' in result) {
        state.error = result.error;
        state.entries = [];
        state.total = 0;
      } else {
        state.entries = result.rows;
        state.total = result.total;
        state.selectedIds.clear();
      }
    } catch (err) {
      state.error = `Error: ${errorMessage(err)}`;
      state.entries = [];
      state.total = 0;
    } finally {
      state.loading = false;
      currentEnrichmentMap = await getChromeStorageLookup();
      refresh();
    }
  }

  function updateTagFilterBar(
    containerEl: HTMLElement,
    activeTagFilter: string | null,
    onClear: () => void,
  ): void {
    const existingBar = containerEl.querySelector('#sqlite-tag-filter-bar') as HTMLElement | null;
    if (activeTagFilter) {
      if (!existingBar) {
        const bar = document.createElement('div');
        bar.id = 'sqlite-tag-filter-bar';
        bar.className = 'sqlite-tag-filter-bar';
        bar.setAttribute('role', 'status');
        bar.innerHTML = `
          <span data-i18n="tagFilterLabel">\u30D5\u30A3\u30EB\u30BF\u30FC:</span>
          <span class="tag-filter-badge">#${escapeHtml(activeTagFilter)}</span>
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
  }

  function updateDynamicRegions(): void {
    const countEl = container?.querySelector('.sqlite-history-count');
    if (countEl) countEl.textContent = t(getPluralKey('historyRecordCount', state.total), [String(state.total)]);

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
        () => {
          state.activeTagFilter = null;
          state.currentPage = 0;
          void fetchData({ page: 0, ...dateRangeFromSelected() });
        },
      );
    }

    const calContainer = document.getElementById('sqlite-calendar-nav');
    if (calContainer) {
      renderCalendarNav(calContainer, state.selectedDate,
        { searchQuery: state.searchQuery, activeTagFilter: state.activeTagFilter },
        {
          onDateSelect: (d) => void handleDateSelect(d),
          onRangeSelect: (since, until) => { state.selectedDate = null; state.searchQuery = ''; state.currentPage = 0; void fetchData({ since, until }); },
          onClearFilters: () => { state.searchQuery = ''; state.selectedDate = null; state.activeTagFilter = null; state.currentPage = 0; void fetchData(); },
        }
      );
    }

    const listContainer = document.getElementById('sqlite-entry-list');
    if (listContainer) {
      if (state.loading) {
        listContainer.innerHTML = `<div class="loading">${t('historyLoading')}</div>`;
      } else {
        renderEntryList(listContainer, state.entries, state.selectedIds, state.activeTagFilter, currentEnrichmentMap, {
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
    _enrichmentMap: Map<string, SavedUrlEntry> | null,
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

    const enrichedEntries = _enrichmentMap
      ? displayEntries.map(e => enrichEntryWithChromeStorage(e, _enrichmentMap!))
      : displayEntries;

    _container.innerHTML = enrichedEntries.map(entry => {
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
        ${state.activeTagFilter ? `
        <div id="sqlite-tag-filter-bar" class="sqlite-tag-filter-bar" role="status">
          <span data-i18n="tagFilterLabel">\u30D5\u30A3\u30EB\u30BF\u30FC:</span>
          <span class="tag-filter-badge">#${escapeHtml(state.activeTagFilter)}</span>
          <button type="button" id="sqlite-tag-filter-clear" class="tag-filter-clear" aria-label="${t('clearTagFilter') || 'Clear tag filter'}">\u2715</button>
        </div>` : ''}
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
            onRangeSelect: (since, until) => { state.selectedDate = null; state.searchQuery = ''; state.currentPage = 0; void fetchData({ since, until }); },
            onClearFilters: () => { state.searchQuery = ''; state.selectedDate = null; state.activeTagFilter = null; state.currentPage = 0; void fetchData(); },
          }
        );
      }

      const listContainer = document.getElementById('sqlite-entry-list');
      if (listContainer) {
        renderEntryList(listContainer, state.entries, state.selectedIds, state.activeTagFilter, currentEnrichmentMap, {
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

    const tagFilterClear = document.getElementById('sqlite-tag-filter-clear') as HTMLButtonElement | null;
    if (tagFilterClear) {
      tagFilterClear.addEventListener('click', () => {
        state.activeTagFilter = null;
        refresh();
      });
    }
  }

  function refresh(): void {
    if (isPanelMounted()) {
      updateDynamicRegions();
    } else {
      renderState();
    }
  }

  async function checkFallbackStatus(): Promise<void> {
    try {
      const status = await getSqliteStatus();
      if (status?.fallback) {
        state.fallbackMode = true;
        renderState();
      }
    } catch {
      // Ignore
    }
  }

  async function retryInitialLoad(): Promise<void> {
    state.loading = true;
    state.error = null;
    renderState();

    const result = await retryWithExponentialBackoff<boolean>(
      async () => {
        await fetchData({ limit: PAGE_SIZE });
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
      currentEnrichmentMap = await getChromeStorageLookup();
      renderState();
      void retryInitialLoad();
    },
    unmount() {
      if (searchDebounceTimer !== null) {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = null;
      }
      isMounted = false;
      // Clear bulk bar listener references
      state.selectedIds.clear();
    },
    onActivate(init) {
      if (init?.searchTag) {
        state.activeTagFilter = init.searchTag as string;
        state.currentPage = 0;
        void fetchData({ page: 0, tagFilter: state.activeTagFilter || undefined });
      } else if (init?.searchDomain) {
        state.searchQuery = init.searchDomain as string;
        state.currentPage = 0;
        if (state.searchQuery.trim()) {
          void fetchData({ search: state.searchQuery.trim() });
        }
      }
    },
  };
}
