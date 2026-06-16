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
} from './dashboardSqliteService.js';
import type { BrowsingLogEntry } from './dashboardSqliteService.js';
import { showConfirmDialog } from './utils/confirmDialog.js';
import { errorMessage } from '../utils/errorUtils.js';

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
} = {}): Promise<void> {
  state.loading = true;
  state.error = null;
  renderState();

  try {
    const page = options.page ?? state.currentPage;
    const limit = PAGE_SIZE;
    const offset = page * limit;

    let result: { rows: BrowsingLogEntry[]; total: number } | null;

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
      });
    }

    if (result) {
      state.entries = result.rows;
      state.total = result.total;
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
    renderState();
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
    renderEntryList();
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
}

function renderEntryList(): void {
  const listEl = document.getElementById('sqlite-entry-list');
  if (!listEl) return;

  if (state.entries.length === 0) {
    listEl.innerHTML = `<div class="empty-state">${t('historyNoRecords')}</div>`;
    return;
  }

  listEl.innerHTML = state.entries.map(entry => `
    <div class="sqlite-entry" data-id="${entry.id}">
      <div class="sqlite-entry-header">
        <button type="button" class="sqlite-entry-star ${entry.is_starred ? 'starred' : ''}"
                data-action="star" title="${t('historyToggleStar')}" 
                aria-pressed="${entry.is_starred}" aria-label="${t('historyToggleStar')}">★</button>
        <a href="${escapeHtml(entry.url)}" target="_blank" class="sqlite-entry-title">
          ${escapeHtml(entry.title || entry.url)}
        </a>
        <button type="button" class="sqlite-entry-delete" data-action="delete" title="${t('historyDeleteRecord')}" aria-label="${t('historyDeleteRecordAria')}">✕</button>
      </div>
      <div class="sqlite-entry-meta">
        <span class="sqlite-entry-domain">${escapeHtml(entry.domain || '')}</span>
        <span class="sqlite-entry-time">${formatTimestamp(entry.created_at)}</span>
      </div>
      ${entry.summary ? `<div class="sqlite-entry-summary">${escapeHtml(entry.summary)}</div>` : ''}
    </div>
  `).join('');

  // Wire action buttons
  listEl.querySelectorAll('[data-action="star"]').forEach((el, i) => {
    el.addEventListener('click', () => handleToggleStar(state.entries[i].id));
  });
  listEl.querySelectorAll('[data-action="delete"]').forEach((el, i) => {
    el.addEventListener('click', () => handleDelete(state.entries[i].id));
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

  // Generate quick date buttons: today, yesterday, this week, and month days
  navEl.innerHTML = `
    <div class="sqlite-calendar-quick">
      <button data-date="${formatDate(now)}">${t('historyToday')}</button>
      <button data-date="${formatDate(new Date(now.getTime() - 86400000))}">${t('historyYesterday')}</button>
      <button data-date="${formatDate(now)}" data-range="7">${t('historyLast7Days')}</button>
      <button data-date="${formatDate(now)}" data-range="30">${t('historyLast30Days')}</button>
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

function reloadCurrent(): void {
  if (state.searchQuery.trim()) {
    loadData({ search: state.searchQuery, page: state.currentPage });
  } else if (state.selectedDate) {
    const date = new Date(state.selectedDate + 'T00:00:00');
    const since = date.getTime();
    const until = date.getTime() + 86400000 - 1;
    loadData({ since, until, page: state.currentPage });
  } else {
    loadData({ page: state.currentPage });
  }
}

// ============================================================================
// Initialization
// ============================================================================

let initCalled = false;

const RETRY_MAX_ATTEMPTS = 4;
const RETRY_BASE_DELAY_MS = 500;

/**
 * Load data with retry on failure. On first load the SQLite client in the
 * service worker may not be fully initialized yet (requires Offscreen Document
 * setup + WASM loading), so we retry with backoff rather than showing an error.
 */
async function retryInitialLoad(): Promise<void> {
  let lastError: string | null = null;
  for (let attempt = 0; attempt < RETRY_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      // Show persistent loading state during retries
      state.loading = true;
      state.error = null;
      renderState();
      await new Promise(resolve => setTimeout(resolve, RETRY_BASE_DELAY_MS * attempt));
    }
    await loadData({ limit: PAGE_SIZE });
    if (!state.error) {
      // Success — data loaded
      return;
    }
    lastError = state.error;
    // Clear error so retry shows loading indicator, not the stale error
    state.error = null;
  }
  // All retries exhausted — show the last error
  state.error = lastError;
  state.loading = false;
  renderState();
}

export function initSqliteHistoryPanel(): void {
  if (initCalled) return;
  initCalled = true;

  const container = document.getElementById('sqlite-history-container');
  if (!container) {
    console.warn('SQLite history container not found in DOM');
    return;
  }

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

function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// Expose for dashboard integration
export const _test = { formatDate, escapeHtml };
