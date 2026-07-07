/**
 * sqliteHistoryPanel.ts
 * SQLite-powered history view for the dashboard.
 * Features: calendar navigation, FTS5 search, star/delete actions.
 */

import {
  queryLogs,
  searchLogs,
  toggleStar,
  deleteLog,
  getLogCount,
  getSqliteStatus,
  appendToLogs,
} from './dashboardSqliteService.js';
import { getSavedUrlEntries } from '../utils/storageUrls.js';
import type { SavedUrlEntry } from '../utils/storageUrls.js';
import type { BrowsingLogEntry } from './dashboardSqliteService.js';
import { showConfirmDialog } from './utils/confirmDialog.js';
import { retryWithExponentialBackoff } from './utils/retry.js';
import { errorMessage } from '../utils/errorUtils.js';
import { formatEntryToMarkdown } from '../utils/markdownFormatter.js';
import { copyTextToClipboard } from '../utils/clipboard.js';
import { parseTagsForDisplay } from '../utils/tagUtils.js';
import { getSettings, StorageKeys } from '../utils/storage.js';

const PAGE_SIZE = 20;

function t(key: string, substitutions?: string | string[]): string {
  return chrome.i18n.getMessage(key, substitutions as string | string[]) || key;
}

interface SqliteHistoryState {
  entries: BrowsingLogEntry[];
  total: number;
  currentPage: number;
  searchQuery: string;
  selectedDate: string | null; // YYYY-MM-DD
  loading: boolean;
  error: string | null;
  fallbackMode: boolean;
  selectedIds: Set<number>;
  activeTagFilter: string | null;
  showContent: boolean;
}

let state: SqliteHistoryState = {
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
  showContent: false,
};

// ============================================================================
// Calendar helpers
// ============================================================================

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getMonthDateRange(year: number, month: number): { since: number; until: number } {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
  return { since: start.getTime(), until: end.getTime() };
}

// ============================================================================
// Data loading
// ============================================================================

async function loadData(options: {
  limit?: number;
  since?: number;
  until?: number;
  search?: string;
  page?: number;
  tagFilter?: string;
} = {}): Promise<void> {
  state.loading = true;
  state.error = null;
  // Bug fix: do NOT rebuild the whole panel (which recreates the search <input>
  // and resets the caret to the start) on every keystroke. When the panel is
  // already mounted, update only the dynamic regions and keep the input intact.
  if (isPanelMounted()) {
    updateDynamicRegions();
  } else {
    renderState();
  }

  try {
    const page = options.page ?? state.currentPage;
    const limit = PAGE_SIZE;
    const offset = page * limit;

    let result: { rows: BrowsingLogEntry[]; total: number } | null;

    // Use tagFilter from options or state, preferring explicit options
    const activeTagFilter = options.tagFilter !== undefined ? options.tagFilter : state.activeTagFilter;

    if (options.search) {
      result = await searchLogs(options.search, limit, offset);
    } else {
      result = await queryLogs({
        limit,
        offset,
        since: options.since,
        until: options.until,
        orderBy: 'created_at',
        orderDir: 'DESC',
        tagFilter: activeTagFilter || undefined,
      });
    }

    if (result) {
      state.entries = result.rows;
      state.total = result.total;
      // Reset selection when entries change (search, pagination, date)
      state.selectedIds.clear();
    } else {
      state.error = t('historyLoadError');
      state.entries = [];
      state.total = 0;
    }
  } catch (err) {
    state.error = `Error: ${errorMessage(err)}`;
    state.entries = [];
    state.total = 0;
  } finally {
    state.loading = false;
    if (isPanelMounted()) {
      updateDynamicRegions();
    } else {
      renderState();
    }
  }
}

/** True once the panel (and its search input) has been mounted into the DOM. */
function isPanelMounted(): boolean {
  return document.getElementById('sqlite-search-input') !== null;
}

/**
 * Update only the dynamic regions of an already-mounted panel without
 * recreating the search <input> (which would reset the caret position).
 */
function updateDynamicRegions(): void {
  const countEl = document.querySelector('.sqlite-history-count');
  if (countEl) countEl.textContent = t('historyRecordCount', [String(state.total)]);

  const errorEl = document.getElementById('sqlite-error');
  if (errorEl) {
    errorEl.textContent = state.error || '';
    (errorEl as HTMLElement).style.display = state.error ? '' : 'none';
  }

  updateTagFilterBar();

  // Re-render calendar nav so the "clear filters" button shows/hides
  renderCalendarNav();

  const listEl = document.getElementById('sqlite-entry-list');
  if (listEl) {
    if (state.loading) {
      listEl.innerHTML = `<div class="loading">${t('historyLoading')}</div>`;
    } else {
      renderEntryList();
    }
  }

  if (!state.loading) {
    renderPagination();
  }
}

/** Show or hide the tag filter bar in an already-mounted panel. */
function updateTagFilterBar(): void {
  const searchArea = document.querySelector('.sqlite-history-search');
  if (!searchArea) return;

  const existingBar = document.getElementById('sqlite-tag-filter-bar');
  if (state.activeTagFilter) {
    if (!existingBar) {
      const bar = document.createElement('div');
      bar.id = 'sqlite-tag-filter-bar';
      bar.className = 'sqlite-tag-filter-bar';
      bar.setAttribute('role', 'status');
      bar.innerHTML = `
        <span data-i18n="tagFilterLabel">フィルター:</span>
        <span class="tag-filter-badge">#${escapeHtml(state.activeTagFilter)}</span>
        <button type="button" id="sqlite-tag-filter-clear" class="tag-filter-clear" aria-label="${t('clearTagFilter') || 'Clear tag filter'}">✕</button>`;
      searchArea.appendChild(bar);
      const clearBtn = bar.querySelector('#sqlite-tag-filter-clear') as HTMLButtonElement | null;
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          state.activeTagFilter = null;
          state.currentPage = 0;
          loadData({ page: 0, ...dateRangeFromSelected() });
        });
      }
    }
  } else {
    if (existingBar) {
      existingBar.remove();
    }
  }
}

// ============================================================================
// Actions
// ============================================================================

async function handleToggleStar(id: number): Promise<void> {
  const result = await toggleStar(id);
  if (result) {
    // Update the entry in local state
    const entry = state.entries.find(e => e.id === id);
    if (entry) entry.is_starred = result.is_starred;
    renderEntryList();
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
    renderEntryList();
    updateBulkBar();
  }
}

function createCopyButton(entry: BrowsingLogEntry): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'history-copy-btn sqlite-entry-copy';
  button.setAttribute('aria-label', t('copyMarkdown') || 'Copy Markdown');
  const originalIcon = '📋';
  button.textContent = originalIcon;
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const markdown = formatEntryToMarkdown(entry);
      await copyTextToClipboard(markdown);
      button.textContent = '✓';
      button.setAttribute('aria-label', t('copyMarkdownSuccess') || 'Copied to clipboard');
      setTimeout(() => {
        button.textContent = originalIcon;
        button.setAttribute('aria-label', t('copyMarkdown') || 'Copy Markdown');
        button.disabled = false;
      }, 2000);
    } catch {
      button.textContent = '✗';
      button.setAttribute('aria-label', t('copyMarkdownError') || 'Failed to copy');
      setTimeout(() => {
        button.textContent = originalIcon;
        button.setAttribute('aria-label', t('copyMarkdown') || 'Copy Markdown');
        button.disabled = false;
      }, 2000);
    }
  });
  return button;
}

function updateBulkBar(): void {
  const bar = document.getElementById('sqlite-bulk-bar');
  const selectAll = document.getElementById('sqlite-select-all') as HTMLInputElement | null;
  const countEl = document.getElementById('sqlite-selection-count');
  const appendBtn = document.getElementById('sqlite-append-obsidian') as HTMLButtonElement | null;

  if (bar) {
    bar.style.display = state.selectedIds.size > 0 ? '' : 'none';
  }

  if (selectAll) {
    selectAll.checked = state.entries.length > 0 && state.selectedIds.size === state.entries.length;
  }

  if (countEl) {
    countEl.textContent = t('historySelectionCount', [String(state.selectedIds.size)]);
  }

  if (appendBtn) {
    appendBtn.disabled = state.selectedIds.size === 0;
  }
}

async function handleAppendToObsidian(): Promise<void> {
  if (state.selectedIds.size === 0) return;

  const ids = Array.from(state.selectedIds);
  const result = await appendToLogs(ids);

  if (result === null) {
    // API Key not configured or connection error
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
    updateBulkBar();
    renderEntryList();
    chrome.notifications?.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('/icons/icon48.png'),
      title: t('historyAppendToObsidian'),
      message: t('historyAppendSuccess', [String(ids.length)]),
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
    loadData({ search: query.trim() });
  } else {
    loadData({ page: 0 });
  }
}

async function handleDateSelect(dateStr: string): Promise<void> {
  state.selectedDate = dateStr;
  state.searchQuery = '';
  state.currentPage = 0;

  const date = new Date(dateStr + 'T00:00:00');
  const since = date.getTime();
  const until = date.getTime() + 86400000 - 1;

  await loadData({ since, until });
}

// ============================================================================
// Rendering
// ============================================================================

function renderState(): void {
  const container = document.getElementById('sqlite-history-container');
  if (!container) return;

  const fallbackBanner = state.fallbackMode
    ? `<div class="sqlite-fallback-warning" role="alert" style="background:#fff3cd;border:1px solid #ffc107;color:#856404;padding:8px 12px;margin-bottom:8px;border-radius:4px;font-size:0.9em;">
        ⚠️ ${t('fallbackStorageWarning')}
       </div>`
    : '';

  container.innerHTML = `
    ${fallbackBanner}
    <div class="sqlite-history-header">
      <h3 data-i18n="sqliteHistoryTitle">SQLite History</h3>
      <span class="sqlite-history-count">${t('historyRecordCount', [String(state.total)])}</span>
    </div>
    <div class="sqlite-history-search">
      <input type="text" id="sqlite-search-input"
        placeholder="${t('historySearchPlaceholder')}"
        value="${escapeHtml(state.searchQuery)}"
        aria-label="${t('historySearchAriaLabel')}" />
      <div id="sqlite-calendar-nav" class="sqlite-calendar-nav"></div>
      <div id="sqlite-error" class="sqlite-history-error" style="${state.error ? '' : 'display:none'}">
        ${escapeHtml(state.error || '')}
      </div>
      ${state.activeTagFilter ? `
      <div id="sqlite-tag-filter-bar" class="sqlite-tag-filter-bar" role="status">
        <span data-i18n="tagFilterLabel">フィルター:</span>
        <span class="tag-filter-badge">#${escapeHtml(state.activeTagFilter)}</span>
        <button type="button" id="sqlite-tag-filter-clear" class="tag-filter-clear" aria-label="${t('clearTagFilter') || 'Clear tag filter'}">✕</button>
      </div>` : ''}
    </div>
    <div id="sqlite-bulk-bar" class="sqlite-bulk-bar" style="${state.selectedIds.size > 0 ? '' : 'display:none'}">
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
    renderEntryList();
    renderPagination();
    renderCalendarNav();
  }

  // Wire search input
  const searchInput = document.getElementById('sqlite-search-input') as HTMLInputElement;
  if (searchInput) {
    searchInput.addEventListener('input', debounce(() => {
      handleSearch(searchInput.value);
    }, 300));
    searchInput.focus();
  }

  // Wire bulk action bar
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
      updateBulkBar();
      renderEntryList();
    });
  }

  if (clearSelectionBtn) {
    clearSelectionBtn.addEventListener('click', () => {
      state.selectedIds.clear();
      updateBulkBar();
      renderEntryList();
    });
  }

  if (appendBtn) {
    appendBtn.addEventListener('click', handleAppendToObsidian);
  }

  // Wire tag filter clear button
  const tagFilterClear = document.getElementById('sqlite-tag-filter-clear') as HTMLButtonElement | null;
  if (tagFilterClear) {
    tagFilterClear.addEventListener('click', () => {
      state.activeTagFilter = null;
      renderState();
    });
  }
}

/**
 * Cache of chrome.storage entries for enriching SQLite entries that
 * are missing diagnostic metadata. Built lazily and invalidated
 * on chrome.storage changes.
 */
let chromeStorageCache: { map: Map<string, SavedUrlEntry>; builtAt: number } | null = null;
const CHROME_STORAGE_CACHE_TTL_MS = 5_000; // 5 seconds

/**
 * Build a lookup map from chrome.storage entries keyed by url+timestamp.
 * Returns null if the cache is fresh and valid.
 */
async function getChromeStorageLookup(): Promise<Map<string, SavedUrlEntry> | null> {
  const now = Date.now();
  if (chromeStorageCache && (now - chromeStorageCache.builtAt) < CHROME_STORAGE_CACHE_TTL_MS) {
    return chromeStorageCache.map;
  }

  try {
    const entries = await getSavedUrlEntries();
    const map = new Map<string, SavedUrlEntry>();
    for (const entry of entries) {
      // Key: url + timestamp (rounded to minute to handle slight clock differences)
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

/**
 * Invalidate the chrome.storage cache (call when storage changes).
 */
function invalidateChromeStorageCache(): void {
  chromeStorageCache = null;
}

/**
 * Enrich a SQLite entry with diagnostic metadata from chrome.storage
 * if the SQLite entry is missing those fields. Returns a new object
 * (does not mutate the original).
 */
function enrichEntryWithChromeStorage(
  entry: BrowsingLogEntry,
  storageMap: Map<string, SavedUrlEntry>
): BrowsingLogEntry {
  // If the SQLite entry already has diagnostic data, return as-is
  if (entry.sent_tokens != null || entry.received_tokens != null ||
      entry.page_bytes != null || entry.ai_provider != null) {
    return entry;
  }

  // Look up in chrome.storage
  const key = `${entry.url}|${Math.floor(entry.created_at / 60000)}`;
  const storageEntry = storageMap.get(key);
  if (!storageEntry) {
    return entry;
  }

  // Merge diagnostic fields from chrome.storage
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

async function renderEntryList(): Promise<void> {
  const listEl = document.getElementById('sqlite-entry-list');
  if (!listEl) return;

  // Server-side tag filter: state.entries already filtered by loadData with tagFilter
  const displayEntries = state.entries;

  if (displayEntries.length === 0) {
    listEl.innerHTML = `<div class="empty-state">${t('historyNoRecords')}</div>`;
    return;
  }

  // Enrich entries with chrome.storage data if they lack diagnostic metadata.
  // This is a lazy merge: entries already in SQLite with metrics are unchanged.
  // Entries missing metrics are enriched from the most recent chrome.storage
  // state. This handles the case where the SQLite entry was created by an
  // older version of the pipeline that did not save diagnostic fields.
  const enrichmentMap = await getChromeStorageLookup();
  const enrichedEntries = enrichmentMap
    ? displayEntries.map(e => enrichEntryWithChromeStorage(e, enrichmentMap))
    : displayEntries;

  listEl.innerHTML = enrichedEntries.map(entry => {
    const entryTags = parseTagsForDisplay(entry.tags);
    const tagsHtml = entryTags.length > 0
      ? `<div class="sqlite-entry-tags">${entryTags.map(tag => {
          const isActive = state.activeTagFilter === tag;
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
               data-id="${entry.id}" ${state.selectedIds.has(entry.id) ? 'checked' : ''}
               aria-label="${t('historySelectRecord')}">
        <button type="button" class="sqlite-entry-star ${entry.is_starred ? 'starred' : ''}"
                data-action="star" title="${t('historyToggleStar')}"
                 aria-pressed="${String(Boolean(entry.is_starred))}" aria-label="${t('historyToggleStar')}">★</button>
        <a href="${escapeHtml(entry.url)}" target="_blank" class="sqlite-entry-title">
          ${escapeHtml(entry.title || entry.url)}
        </a>
        <button type="button" class="sqlite-entry-delete" data-action="delete" title="${t('historyDeleteRecord')}" aria-label="${t('historyDeleteRecordAria')}">✕</button>
      </div>
      <div class="sqlite-entry-meta">
        <span class="sqlite-entry-domain">${escapeHtml(entry.domain || '')}</span>
        <span class="sqlite-entry-time">${formatTimestamp(entry.created_at)}</span>
      </div>
      ${diagnosticMetadataHtml ? `<div class="sqlite-entry-diagnostics">${diagnosticMetadataHtml}</div>` : ''}
      ${entry.content != null && state.showContent ? `
        <button type="button" class="content-toggle-btn" data-action="content-toggle"
                data-id="${entry.id}" aria-expanded="false" aria-controls="content-sent-${entry.id}">
          ${t('historyShowSentData') || 'AIへ送信したデータ'}
        </button>
        <div class="content-preview hidden" id="content-sent-${entry.id}">${escapeHtml(entry.content)}</div>
      ` : ''}
      ${entry.summary != null && entry.summary.trim().length > 0 && state.showContent ? `
        <button type="button" class="content-toggle-btn" data-action="content-toggle"
                data-id="${entry.id}" aria-expanded="false" aria-controls="content-received-${entry.id}">
          ${t('historyShowReceivedData') || 'AIから受信したデータ'}
        </button>
        <div class="content-preview hidden" id="content-received-${entry.id}">${escapeHtml(entry.summary)}</div>
      ` : ''}
      ${tagsHtml}
    </div>`;
  }).join('');

  // Wire action buttons
  listEl.querySelectorAll('[data-action="select"]').forEach((el) => {
    const id = Number((el as HTMLElement).getAttribute('data-id'));
    el.addEventListener('change', () => {
      const checkbox = el as HTMLInputElement;
      if (checkbox.checked) {
        state.selectedIds.add(id);
      } else {
        state.selectedIds.delete(id);
      }
      updateBulkBar();
    });
  });
  listEl.querySelectorAll('[data-action="star"]').forEach((el) => {
    const entryId = Number((el as HTMLElement).closest('.sqlite-entry')?.getAttribute('data-id'));
    if (entryId) el.addEventListener('click', () => handleToggleStar(entryId));
  });
  listEl.querySelectorAll('[data-action="delete"]').forEach((el) => {
    const entryId = Number((el as HTMLElement).closest('.sqlite-entry')?.getAttribute('data-id'));
    if (entryId) el.addEventListener('click', () => handleDelete(entryId));
  });

  displayEntries.forEach(entry => {
    const entryEl = listEl.querySelector(`.sqlite-entry[data-id="${entry.id}"] .sqlite-entry-header`);
    if (entryEl) {
      entryEl.appendChild(createCopyButton(entry));
    }
  });

  // Wire tag filter buttons — server-side via loadData (preserve date range)
  listEl.querySelectorAll('[data-action="content-toggle"]').forEach((el) => {
    el.addEventListener('click', () => {
      const controlsId = el.getAttribute('aria-controls');
      if (!controlsId) return;
      const area = document.getElementById(controlsId);
      if (!area) return;
      const isHidden = area.classList.toggle('hidden');
      el.setAttribute('aria-expanded', String(!isHidden));
      const btn = el as HTMLButtonElement;
      if (controlsId.startsWith('content-sent-')) {
        btn.textContent = isHidden ? (t('historyShowSentData') || 'AIへ送信したデータ') : (t('historyHideSentData') || 'データを非表示');
      } else if (controlsId.startsWith('content-received-')) {
        btn.textContent = isHidden ? (t('historyShowReceivedData') || 'AIから受信したデータ') : (t('historyHideReceivedData') || 'データを非表示');
      } else {
        btn.textContent = isHidden ? t('historyShowContent') : t('historyHideContent');
      }
    });
  });

  listEl.querySelectorAll('[data-action="tag-filter"]').forEach((el) => {
    el.addEventListener('click', () => {
      const tag = (el as HTMLElement).getAttribute('data-tag');
      if (!tag) return;
      const newFilter = state.activeTagFilter === tag ? null : tag;
      state.activeTagFilter = newFilter;
      state.currentPage = 0;
      loadData({ page: 0, tagFilter: newFilter || undefined, ...dateRangeFromSelected() });
    });
  });
}

function renderPagination(): void {
  const pagEl = document.getElementById('sqlite-pagination');
  if (!pagEl) return;

  const totalPages = Math.ceil(state.total / PAGE_SIZE);
  if (totalPages <= 1) {
    pagEl.innerHTML = '';
    return;
  }

  pagEl.innerHTML = `
    <button ${state.currentPage === 0 ? 'disabled' : ''} data-page="prev">${t('historyPrev')}</button>
    <span>${t('historyPageInfo', [String(state.currentPage + 1), String(totalPages)])}</span>
    <button ${state.currentPage >= totalPages - 1 ? 'disabled' : ''} data-page="next">${t('historyNext')}</button>
  `;

  pagEl.querySelector('[data-page="prev"]')?.addEventListener('click', () => {
    state.currentPage--;
    reloadCurrent();
  });
  pagEl.querySelector('[data-page="next"]')?.addEventListener('click', () => {
    state.currentPage++;
    reloadCurrent();
  });
}

function renderCalendarNav(): void {
  const navEl = document.getElementById('sqlite-calendar-nav');
  if (!navEl) return;

  const now = new Date();
  const currentMonth = state.selectedDate
    ? new Date(state.selectedDate + 'T00:00:00')
    : now;

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  // Determine if any filter is active
  const hasActiveFilters = Boolean(state.searchQuery.trim()) || state.selectedDate != null || state.activeTagFilter != null;

  // Generate quick date buttons: today, yesterday, this week, and month days
  navEl.innerHTML = `
    <div class="sqlite-calendar-quick">
      <button data-date="${formatDate(now)}">${t('historyToday')}</button>
      <button data-date="${formatDate(new Date(now.getTime() - 86400000))}">${t('historyYesterday')}</button>
      <button data-date="${formatDate(now)}" data-range="7">${t('historyLast7Days')}</button>
      <button data-date="${formatDate(now)}" data-range="30">${t('historyLast30Days')}</button>
      ${hasActiveFilters ? `<button type="button" id="sqlite-clear-all-filters" class="sqlite-clear-filters-btn" aria-label="${t('clearAllFilters') || 'Clear all filters'}">${t('clearAllFilters') || '条件をクリア'}</button>` : ''}
    </div>
    <div class="sqlite-calendar-month">
      <button data-month-prev>&lt;</button>
      <span>${year}-${String(month + 1).padStart(2, '0')}</span>
      <button data-month-next>&gt;</button>
    </div>
    <div class="sqlite-calendar-days" id="sqlite-calendar-days"></div>
  `;

  // Quick buttons
  navEl.querySelectorAll('[data-date]').forEach(el => {
    el.addEventListener('click', () => {
      const date = (el as HTMLElement).dataset.date!;
      const range = (el as HTMLElement).dataset.range;
      if (range) {
        const d = new Date(date + 'T00:00:00');
        const since = d.getTime() - (Number(range) * 86400000);
        state.selectedDate = null;
        state.searchQuery = '';
        state.currentPage = 0;
        loadData({ since, until: d.getTime() + 86400000 - 1 });
      } else {
        handleDateSelect(date);
      }
    });
  });

  // Month nav
  navEl.querySelector('[data-month-prev]')?.addEventListener('click', () => {
    const d = new Date(year, month - 1, 1);
    state.selectedDate = formatDate(d);
    renderCalendarNav();
    handleDateSelect(state.selectedDate!);
  });
  navEl.querySelector('[data-month-next]')?.addEventListener('click', () => {
    const d = new Date(year, month + 1, 1);
    state.selectedDate = formatDate(d);
    renderCalendarNav();
    handleDateSelect(state.selectedDate!);
  });

  // Clear all filters button
  navEl.querySelector('#sqlite-clear-all-filters')?.addEventListener('click', () => {
    state.searchQuery = '';
    state.selectedDate = null;
    state.activeTagFilter = null;
    state.currentPage = 0;

    // Also clear the search input
    const searchInput = document.getElementById('sqlite-search-input') as HTMLInputElement | null;
    if (searchInput) searchInput.value = '';

    loadData({ page: 0 });
    renderCalendarNav();
    renderState();
  });

  // Render days of the month
  const daysEl = document.getElementById('sqlite-calendar-days');
  if (!daysEl) return;

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();

  let daysHtml = '';
  // Empty cells for days before the 1st
  for (let i = 0; i < firstDay; i++) {
    daysHtml += '<span class="day empty" aria-hidden="true"></span>';
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isSelected = dateStr === state.selectedDate;
    const isToday = dateStr === formatDate(now);
    const dateLabel = `${year}${t('historyDateYear')}${month + 1}${t('historyDateMonth')}${d}${t('historyDateDay')}`;
    daysHtml += `<button type="button" class="day${isSelected ? ' selected' : ''}${isToday ? ' today' : ''}"
      data-date="${dateStr}" aria-pressed="${isSelected}" aria-label="${dateLabel}">${d}</button>`;
  }
  daysEl.innerHTML = daysHtml;

  daysEl.querySelectorAll('.day:not(.empty)').forEach(el => {
    el.addEventListener('click', () => {
      handleDateSelect((el as HTMLElement).dataset.date!);
    });
  });
}

/** Compute date range from selectedDate. */
function dateRangeFromSelected(): { since?: number; until?: number } {
  if (!state.selectedDate) return {};
  const date = new Date(state.selectedDate + 'T00:00:00');
  return { since: date.getTime(), until: date.getTime() + 86400000 - 1 };
}

function reloadCurrent(): void {
  if (state.searchQuery.trim()) {
    loadData({ search: state.searchQuery, page: state.currentPage });
  } else {
    loadData({ ...dateRangeFromSelected(), page: state.currentPage });
  }
}

// ============================================================================
// Initialization
// ============================================================================

let initCalled = false;

/**
 * Load data with retry on failure using exponential backoff.
 * On first load the SQLite client in the service worker may not be fully
 * initialized yet (requires Offscreen Document setup + WASM loading), so we
 * retry with backoff rather than showing a permanent error.
 */
async function retryInitialLoad(): Promise<void> {
  state.loading = true;
  state.error = null;
  renderState();

  const result = await retryWithExponentialBackoff<boolean>(
    async () => {
      await loadData({ limit: PAGE_SIZE });
      return state.error ? null : true;
    },
    { label: 'sqliteHistory', maxAttempts: 4 }
  );

  state.loading = false;
  if (!result) {
    // All retries exhausted — error is already set by loadData
  }
  renderState();
}

async function loadContentSetting(): Promise<void> {
  try {
    const settings = await getSettings();
    state.showContent = Boolean(settings[StorageKeys.SHOW_SQLITE_CONTENT]);
  } catch {
    state.showContent = false;
  }
}

export async function initSqliteHistoryPanel(): Promise<void> {
  if (initCalled) return;
  initCalled = true;

  const container = document.getElementById('sqlite-history-container');
  if (!container) {
    console.warn('SQLite history container not found in DOM');
    return;
  }

  await loadContentSetting();
  checkFallbackStatus();
  renderState();
  retryInitialLoad();
}

async function checkFallbackStatus(): Promise<void> {
  try {
    const status = await getSqliteStatus();
    if (status?.fallback) {
      state.fallbackMode = true;
      renderState();
    }
  } catch {
    // Ignore status check failures
  }
}

// ============================================================================
// Utilities
// ============================================================================

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

/**
 * Build structured HTML for diagnostic metadata, matching the left panel's
 * (historyEntryRow.ts) visual style using the same CSS classes.
 * Returns an empty string when no metric data is available.
 */
function formatDiagnosticMetadataHtml(entry: BrowsingLogEntry): string {
  const parts: string[] = [];

  // --- AI summary -----------------------------------------------------------
  if (entry.summary && entry.summary.trim().length > 0) {
    parts.push(`<div class="history-entry-ai-summary">${escapeHtml(entry.summary)}</div>`);
  }

  // --- Token info -----------------------------------------------------------
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

  // --- Content extraction (bytes) -------------------------------------------
  if (entry.page_bytes != null && entry.candidate_bytes != null) {
    const reduction = entry.page_bytes - entry.candidate_bytes;
    const reductionPercent = ((reduction / entry.page_bytes) * 100).toFixed(1);
    parts.push(`<div class="history-entry-token-reduction">${t('historyContentExtraction', [])} — ${t('historyBytes', [])}: ${entry.page_bytes} → ${entry.candidate_bytes} (${t('historyReduction', [])} ${reduction} / ${reductionPercent}%)</div>`);
  }

  // --- Content Cleansing ----------------------------------------------------
  if (entry.original_tokens != null || entry.cleansed_tokens != null ||
      entry.original_bytes != null || entry.cleansed_bytes != null) {
    const cleansingParts: string[] = [];
    if (entry.original_tokens != null && entry.cleansed_tokens != null) {
      cleansingParts.push(`${t('historyTokens', [])}: ${entry.original_tokens} → ${entry.cleansed_tokens}`);
    }
    const contentOriginalB = (entry.original_bytes || entry.candidate_bytes) as number | null | undefined;
    const contentCleansedB = (entry.cleansed_bytes || entry.original_bytes || entry.candidate_bytes) as number | null | undefined;
    if (contentOriginalB != null && contentCleansedB != null) {
      const reduction = contentOriginalB - contentCleansedB;
      const reductionPercent = contentOriginalB > 0 ? ((reduction / contentOriginalB) * 100).toFixed(1) : '0.0';
      cleansingParts.push(`${t('historyBytes', [])}: ${contentOriginalB} → ${contentCleansedB} (${t('historyReduction', [])} ${reduction} / ${reductionPercent}%)`);
    }
    if (cleansingParts.length > 0) {
      parts.push(`<div class="history-entry-token-reduction">Content Cleansing — ${cleansingParts.join(', ')}</div>`);
    }
  }

  // --- AI Summary Cleansing -------------------------------------------------
  if (entry.ai_summary_original_bytes != null && entry.ai_summary_cleansed_bytes != null) {
    const reduction = entry.ai_summary_original_bytes - entry.ai_summary_cleansed_bytes;
    const reductionPercent = entry.ai_summary_original_bytes > 0 ? ((reduction / entry.ai_summary_original_bytes) * 100).toFixed(1) : '0.0';
    parts.push(`<div class="history-entry-ai-summary-cleansing">${t('historyAiSummaryCleansing', [])}: ${entry.ai_summary_original_bytes} → ${entry.ai_summary_cleansed_bytes} (${t('historyReduction', [])} ${reduction} / ${reductionPercent}%)</div>`);
  }

  // --- Cleansing progress bar -----------------------------------------------
  const progressBarHtml = buildCleansingProgressBarHtml(entry);
  if (progressBarHtml) parts.push(progressBarHtml);

  return parts.join('');
}

/**
 * Build an HTML string for the cleansing progress bar, reusing the same CSS
 * classes as the left panel's `makeCleansingProgressBar`.
 */
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
    <div class="cleansing-progress"><div class="cleansing-progress-bar" style="width:${Math.max(sentRatio * 100, 0.2).toFixed(1)}%"></div></div>
    <span class="cleansing-progress-label">${escapeHtml(label)}</span>
  </div>`;
}

/**
 * @deprecated Use formatDiagnosticMetadataHtml instead. Kept only for test
 * backward-compatibility.
 */
function formatDiagnosticMetadata(entry: BrowsingLogEntry): string {
  return formatDiagnosticMetadataHtml(entry);
}

function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// Expose for dashboard integration
export const _test = { formatDate, escapeHtml, formatDiagnosticMetadataHtml, buildCleansingProgressBarHtml };
