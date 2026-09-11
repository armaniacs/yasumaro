import { getMessageOr } from '../../../utils/i18n.js';
import type { BrowsingLogEntry } from './sqliteHistoryQuery.js';
import { parseTagsForDisplay } from '../../../utils/tagUtils.js';
import { isSecureUrl } from '../../../utils/urlUtils.js';
import { escapeHtml } from '../../../utils/htmlEscape.js';
import { getPluralKey } from '../../../utils/i18nPlural.js';
import { renderPendingReason } from '../../../utils/pendingStorage.js';
import type { PendingPage } from '../../../utils/pendingStorage.js';
import type { SqliteHistoryState } from './sqliteHistoryPanelState.js';

function t(key: string, substitutions?: string | string[]): string {
  return getMessageOr(key, key, substitutions);
}

export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function buildCleansingProgressBarHtml(entry: BrowsingLogEntry): string {
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

export function sortSelectValue(sortBy: SqliteHistoryState['sortBy'], sortDir: SqliteHistoryState['sortDir']): string {
  return `${sortBy}:${sortDir}`;
}

export function parseSortSelectValue(value: string): { sortBy: SqliteHistoryState['sortBy']; sortDir: SqliteHistoryState['sortDir'] } {
  const [sortBy, sortDir] = value.split(':');
  return {
    sortBy: sortBy === 'relevance' ? 'relevance' : 'created_at',
    sortDir: sortDir === 'ASC' ? 'ASC' : 'DESC',
  };
}

/**
 * True only when queryHistory will actually take the FTS5 search path
 * (searchLogs, with a real `rank`) — not merely when the search box has
 * text in it. A tag click populates the search box as a display label
 * without running a full-text search (see fetchData's tagInitiated path,
 * which passes tagFilter but never search); relevance sort has nothing to
 * rank against there. A tag-fallback search (pendingTagFallback set) does
 * run FTS5 even while activeTagFilter is still set, so it must not be
 * excluded by a blanket "activeTagFilter present" check.
 */
export function isFullTextSearchActive(state: SqliteHistoryState): boolean {
  if (!state.searchQuery.trim()) return false;
  if (!state.activeTagFilter) return true;
  return state.pendingTagFallback !== null;
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

/** Builds the HTML markup for the entry list. Does not attach listeners. */
export function buildEntryListHtml(
  entries: BrowsingLogEntry[],
  selectedIds: Set<number>,
  activeTagFilter: string | null,
): string {
  if (entries.length === 0) {
    return `<div class="empty-state">${t('historyNoRecords')}</div>`;
  }

  return entries.map(entry => {
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
                 aria-pressed="${String(Boolean(entry.is_starred))}" aria-label="${t('historyToggleStar')}">★</button>
        <a href="${isSecureUrl(entry.url) ? escapeHtml(entry.url) : '#'}" target="_blank" rel="noopener noreferrer" class="sqlite-entry-title">
          ${escapeHtml(entry.title || entry.url)}
        </a>
        <button type="button" class="sqlite-entry-delete" data-action="delete" title="${t('historyDeleteRecord')}" aria-label="${t('historyDeleteRecordAria')}">✕</button>
      </div>
      <div class="sqlite-entry-meta">
        <span class="sqlite-entry-domain">${escapeHtml(entry.domain || '')}</span>
        <span class="sqlite-entry-time">${formatTimestamp(entry.created_at)}</span>
      </div>
      ${diagnosticMetadataHtml ? `<div class="sqlite-entry-diagnostics">${diagnosticMetadataHtml}</div>` : ''}
      ${entry.content != null ? `
        <button type="button" class="content-toggle-btn" data-action="content-toggle"
                data-id="${entry.id}" aria-expanded="false" aria-controls="content-sent-${entry.id}">
          ${t('historyShowSentData') || 'AIに送信したデータ'}
        </button>
        <div class="content-preview hidden" id="content-sent-${entry.id}">${escapeHtml(entry.content)}</div>
      ` : ''}
      ${entry.summary != null && entry.summary.trim().length > 0 ? `
        <button type="button" class="content-toggle-btn" data-action="content-toggle"
                data-id="${entry.id}" aria-expanded="false" aria-controls="content-received-${entry.id}">
          ${t('historyShowReceivedData') || 'AIから受信したデータ'}
        </button>
        <div class="content-preview hidden" id="content-received-${entry.id}">${escapeHtml(entry.summary)}</div>
      ` : ''}
      ${tagsHtml}
    </div>`;
  }).join('');
}

/** Builds the HTML markup for the pagination controls. Empty string when there is only one page. */
export function buildPaginationHtml(currentPage: number, total: number, pageSize: number): string {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return '';

  return `
    <button ${currentPage === 0 ? 'disabled' : ''} data-page="prev">${t('historyPrev')}</button>
    <span>${t('historyPageInfo', [String(currentPage + 1), String(totalPages)])}</span>
    <button ${currentPage >= totalPages - 1 ? 'disabled' : ''} data-page="next">${t('historyNext')}</button>
  `;
}

/** Builds the HTML markup for the sort control select. */
export function buildSortControlHtml(
  sortBy: SqliteHistoryState['sortBy'],
  sortDir: SqliteHistoryState['sortDir'],
  hasActiveSearch: boolean,
): string {
  const options = [
    { value: sortSelectValue('created_at', 'DESC'), label: t('historySortNewest') || '新しい順' },
    { value: sortSelectValue('created_at', 'ASC'), label: t('historySortOldest') || '古い順' },
  ];
  if (hasActiveSearch) {
    options.push({ value: sortSelectValue('relevance', 'DESC'), label: t('historySortRelevance') || '関連度順' });
  }

  const currentValue = sortSelectValue(sortBy, sortDir);
  // A relevance value with no active search cannot be rendered (its option
  // was omitted above); fall back to newest-first so the select always has
  // a matching selected option.
  const safeValue = options.some(o => o.value === currentValue) ? currentValue : sortSelectValue('created_at', 'DESC');

  return `
    <label class="sqlite-sort-label" for="sqlite-sort-select">${t('historySortLabel') || '並び替え'}</label>
    <select id="${SQLITE_HISTORY_IDS.sortSelect}" aria-label="${t('historySortLabel') || '並び替え'}">
      ${options.map(o => `<option value="${o.value}"${o.value === safeValue ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
    </select>
  `;
}

export interface CalendarNavHtml {
  html: string;
  year: number;
  month: number;
}

/** Builds the HTML markup for the calendar navigation shell (quick buttons + month header), excluding the day grid. */
export function buildCalendarNavHtml(
  selectedDate: string | null,
  options: { searchQuery: string; activeTagFilter: string | null },
): CalendarNavHtml {
  const now = new Date();
  const currentMonth = selectedDate
    ? new Date(selectedDate + 'T00:00:00')
    : now;

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const hasActiveFilters = Boolean(options.searchQuery.trim()) || selectedDate != null || options.activeTagFilter != null;

  const html = `
    <div class="sqlite-calendar-quick">
      <button data-date="${formatDate(now)}">${t('historyToday')}</button>
      <button data-date="${formatDate(new Date(now.getTime() - 86400000))}">${t('historyYesterday')}</button>
      <button data-date="${formatDate(now)}" data-range="7">${t('historyLast7Days')}</button>
      <button data-date="${formatDate(now)}" data-range="30">${t('historyLast30Days')}</button>
      ${hasActiveFilters ? `<button type="button" id="${SQLITE_HISTORY_IDS.clearAllFilters}" class="sqlite-clear-filters-btn" aria-label="${t('clearAllFilters') || 'Clear all filters'}">${t('clearAllFilters') || '条件をクリア'}</button>` : ''}
    </div>
    <div class="sqlite-calendar-month">
      <button data-month-prev>&lt;</button>
      <span>${year}-${String(month + 1).padStart(2, '0')}</span>
      <button data-month-next>&gt;</button>
    </div>
    <div class="sqlite-calendar-days" id="${SQLITE_HISTORY_IDS.calendarDays}"></div>
  `;

  return { html, year, month };
}

/** Builds the HTML markup for the calendar day grid for the given year/month. */
export function buildCalendarDaysHtml(year: number, month: number, selectedDate: string | null): string {
  const now = new Date();
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
  return daysHtml;
}

/** Builds the full panel shell HTML (header, search area, bulk bar, list/pagination containers). */
export function buildPanelShellHtml(state: SqliteHistoryState, translateHistoryError: (error: string | null) => string): string {
  const s = state;
  const fallbackBanner = s.fallbackMode
    ? `<div class="sqlite-fallback-warning warning-banner" role="alert">
        ⚠️ ${t('fallbackStorageWarning')}
       </div>`
    : '';

  return `
    ${fallbackBanner}
    <div class="sqlite-history-header">
      <h3 data-i18n="sqliteHistoryTitle">SQLite History</h3>
      <span class="sqlite-history-count">${t(getPluralKey('historyRecordCount', s.total), [String(s.total)])}</span>
    </div>
    <div class="sqlite-history-search">
      <input type="text" id="${SQLITE_HISTORY_IDS.searchInput}"
        placeholder="${t('historySearchPlaceholder')}"
        value="${escapeHtml(s.searchQuery)}"
        aria-label="${t('historySearchAriaLabel')}" />
      <div id="${SQLITE_HISTORY_IDS.sortControl}" class="sqlite-sort-control"></div>
      <div id="${SQLITE_HISTORY_IDS.calendarNav}" class="sqlite-calendar-nav"></div>
      <div id="${SQLITE_HISTORY_IDS.error}" class="sqlite-history-error${s.error ? '' : ' hidden'}">
        ${escapeHtml(translateHistoryError(s.error))}
      </div>
    </div>
    <div id="${SQLITE_HISTORY_IDS.bulkBar}" class="sqlite-bulk-bar${s.selectedIds.size > 0 ? '' : ' hidden'}">
      <label class="sqlite-bulk-select-all">
        <input type="checkbox" id="${SQLITE_HISTORY_IDS.selectAll}" aria-label="${t('historySelectAll')}">
        <span data-i18n="historySelectAll">${t('historySelectAll')}</span>
      </label>
      <button type="button" id="${SQLITE_HISTORY_IDS.clearSelection}" class="secondary-btn" data-i18n="historyClearSelection">${t('historyClearSelection')}</button>
      <span id="${SQLITE_HISTORY_IDS.selectionCount}" class="sqlite-selection-count" aria-live="polite">${t('historySelectionCount', [String(s.selectedIds.size)])}</span>
      <button type="button" id="${SQLITE_HISTORY_IDS.appendObsidian}" class="btn-primary" data-i18n="historyAppendToObsidian">${t('historyAppendToObsidian')}</button>
    </div>
    <div id="${SQLITE_HISTORY_IDS.pendingRegion}" class="sqlite-pending-region"></div>
    <div id="${SQLITE_HISTORY_IDS.entryList}" class="sqlite-entry-list">
      ${s.loading ? `<div class="loading">${t('historyLoading')}</div>` : ''}
    </div>
    <div id="${SQLITE_HISTORY_IDS.pagination}" class="sqlite-pagination"></div>
  `;
}

// ---------------------------------------------------------------------------
// Render ownership (PBI 23) — View は DOM ID の唯一の所有者であり、
// render + wire の単一入口 `render()` を公開する。Panel はこの入口だけを
// 呼び、getElementById / querySelector による直接取得も描画分岐も持たない。
// すべての DOM 取得は container スコープで行う。
// ---------------------------------------------------------------------------

/** Page size shared by the panel shell and pagination wiring. */
export const SQLITE_HISTORY_PAGE_SIZE = 20;

/**
 * Sole owner of every DOM id the SQLite history view creates.
 * Panel, CSS 以外の TS, テストは文字列直書きせずこの定数を経由する。
 */
export const SQLITE_HISTORY_IDS = {
  searchInput: 'sqlite-search-input',
  sortControl: 'sqlite-sort-control',
  sortSelect: 'sqlite-sort-select',
  calendarNav: 'sqlite-calendar-nav',
  calendarDays: 'sqlite-calendar-days',
  clearAllFilters: 'sqlite-clear-all-filters',
  pendingRegion: 'sqlite-pending-region',
  entryList: 'sqlite-entry-list',
  pagination: 'sqlite-pagination',
  error: 'sqlite-error',
  bulkBar: 'sqlite-bulk-bar',
  selectAll: 'sqlite-select-all',
  clearSelection: 'sqlite-clear-selection',
  selectionCount: 'sqlite-selection-count',
  appendObsidian: 'sqlite-append-obsidian',
  tagFilterBar: 'sqlite-tag-filter-bar',
  tagFilterClear: 'sqlite-tag-filter-clear',
} as const;

/** Event + dependency bundle the Panel builds once and hands to `render()`. */
export interface SqliteHistoryViewCallbacks {
  onDateSelect: (dateStr: string) => void;
  onRangeSelect: (since: number, until: number) => void;
  onClearFilters: () => void;
  onSearchInput: (query: string) => void;
  onSortChange: (sortBy: SqliteHistoryState['sortBy'], sortDir: SqliteHistoryState['sortDir']) => void;
  onPageChange: (page: number) => void;
  onToggleStar: (id: number) => void;
  onDelete: (id: number) => void;
  onSelectionChange: (id: number, selected: boolean) => void;
  onTagFilterClick: (tag: string) => void;
  onContentToggle: (controlsId: string) => void;
  onSelectAll: (checked: boolean) => void;
  onClearSelection: () => void;
  onAppend: () => void;
  onTagFilterClear: () => void;
  /** Pure deps owned by the Panel side: error translation + copy-button factory. */
  translateError: (error: string | null) => string;
  createCopyButton: (entry: BrowsingLogEntry) => HTMLButtonElement;
}

/** True when the panel shell is already mounted inside the container. */
export function isViewMounted(container: HTMLElement): boolean {
  return container.querySelector(`#${SQLITE_HISTORY_IDS.searchInput}`) !== null;
}

// ---------------------------------------------------------------------------
// Pending pages region (PBI 2026-09-11-02, PBI-P) — migrated from the legacy
// panel-history. The Panel owns data + chrome.storage.onChanged subscription;
// the View owns ids, markup and in-row feedback for this region.
// ---------------------------------------------------------------------------

export interface PendingRegionActions {
  onRecord: (url: string) => Promise<{ ok: boolean; error?: string }>;
  onRecordWithoutAi: (url: string) => Promise<{ ok: boolean; error?: string }>;
  onDelete: (url: string) => Promise<void>;
}

/** Rows per page in the pending section (parity with the legacy pending panel). */
export const PENDING_REGION_PAGE_SIZE = 10;

function buildPendingRowHtml(page: PendingPage): string {
  const urlEl = isSecureUrl(page.url)
    ? `<a class="history-entry-url" href="${escapeHtml(page.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(page.title || page.url)}</a>`
    : `<span class="history-entry-url">${escapeHtml(page.title || page.url)}</span>`;
  const header = page.headerValue ? `<span class="pending-entry-header"> (${escapeHtml(page.headerValue)})</span>` : '';
  const meta = `${escapeHtml(formatTimestamp(page.timestamp))} — ${escapeHtml(renderPendingReason(page.reason))}${header}`;
  return `<div class="pending-entry" data-pending-url="${escapeHtml(page.url)}">
    <div class="pending-entry-info">
      ${urlEl}
      <div class="pending-entry-meta">${meta}</div>
    </div>
    <div class="pending-entry-actions">
      <button type="button" class="secondary-btn pending-record-btn" data-pending-action="record" data-pending-url="${escapeHtml(page.url)}">${escapeHtml(t('recordNow') || '📝 今すぐ記録')}</button>
      <button type="button" class="secondary-btn pending-record-btn" data-pending-action="recordWithoutAi" data-pending-url="${escapeHtml(page.url)}">${escapeHtml(t('recordWithoutAi') || '📝 AI要約なしで記録')}</button>
      <button type="button" class="secondary-btn pending-delete-btn" data-pending-action="delete" data-pending-url="${escapeHtml(page.url)}">${escapeHtml(t('pendingDeleteForever') || '完全に削除')}</button>
    </div>
  </div>`;
}

function buildPendingRegionInnerHtml(pages: PendingPage[]): string {
  const sorted = [...pages].sort((a, b) => b.timestamp - a.timestamp);
  const rows = sorted.slice(0, PENDING_REGION_PAGE_SIZE).map((p) => buildPendingRowHtml(p)).join('');
  const more = sorted.length > PENDING_REGION_PAGE_SIZE
    ? `<div class="pending-entry-more">${escapeHtml(t('pendingMoreCount', [String(sorted.length - PENDING_REGION_PAGE_SIZE)]))}</div>`
    : '';
  return `<div class="pending-section">
    <h4 data-i18n="pendingSectionTitle">${t('pendingSectionTitle')}</h4>
    ${rows}
    ${more}
  </div>`;
}

/**
 * Region-scoped render entry for pending pages (the shell placeholder
 * `<div id="sqlite-pending-region">` is owned by buildPanelShellHtml; this
 * function fills it). Re-rendered wholesale on data change — per-render
 * button wiring is safe because the region's innerHTML is replaced.
 */
export function renderPendingRegion(
  container: HTMLElement,
  pages: PendingPage[],
  actions: PendingRegionActions,
): void {
  const region = queryById<HTMLElement>(container, SQLITE_HISTORY_IDS.pendingRegion);
  if (!region) return;

  if (pages.length === 0) {
    region.innerHTML = '';
    return;
  }

  region.innerHTML = buildPendingRegionInnerHtml(pages);

  for (const btn of Array.from(region.querySelectorAll<HTMLButtonElement>('[data-pending-action]'))) {
    const url = btn.dataset.pendingUrl ?? '';
    const action = btn.dataset.pendingAction;
    const row = btn.closest('.pending-entry') as HTMLElement | null;
    btn.addEventListener('click', () => {
      void (async () => {
        const label = btn.textContent;
        btn.disabled = true;
        btn.textContent = t('processing') || '処理中...';
        try {
          if (action === 'delete') {
            await actions.onDelete(url);
            return;
          }
          const result = await (action === 'record' ? actions.onRecord(url) : actions.onRecordWithoutAi(url));
          if (result.ok) return;
          // Failure: restore the button and surface the reason in-row.
          btn.disabled = false;
          btn.textContent = label;
          if (row) {
            row.querySelector('.record-error-message')?.remove();
            const msg = document.createElement('div');
            msg.className = 'record-error-message';
            msg.textContent = result.error ?? t('recordError');
            row.appendChild(msg);
          }
        } catch (error) {
          btn.disabled = false;
          btn.textContent = label;
          if (row) {
            row.querySelector('.record-error-message')?.remove();
            const msg = document.createElement('div');
            msg.className = 'record-error-message';
            msg.textContent = error instanceof Error ? error.message : t('recordError');
            row.appendChild(msg);
          }
        }
      })();
    });
  }
}

/**
 * Single render entry. The diff/full decision lives here and nowhere else:
 * a mounted shell is updated region-by-region (focus + input state preserved),
 * otherwise the shell is rebuilt from scratch and wired.
 */
export function render(
  container: HTMLElement,
  state: SqliteHistoryState,
  callbacks: SqliteHistoryViewCallbacks,
): void {
  if (isViewMounted(container)) {
    updateDynamicRegions(container, state, callbacks);
  } else {
    renderFull(container, state, callbacks);
  }
}

function queryById<T extends Element>(root: ParentNode, id: string): T | null {
  return root.querySelector(`#${id}`) as T | null;
}

export function toggleContentArea(root: ParentNode, controlsId: string): void {
  const area = queryById<HTMLElement>(root, controlsId);
  if (!area) return;
  const isHidden = area.classList.toggle('hidden');
  const btn = root.querySelector(`[aria-controls="${controlsId}"]`) as HTMLButtonElement | null;
  if (!btn) return;
  btn.setAttribute('aria-expanded', String(!isHidden));
  if (controlsId.startsWith('content-sent-')) {
    btn.textContent = isHidden ? (t('historyShowSentData') || 'AIに送信したデータ') : (t('historyHideSentData') || 'データを非表示');
  } else if (controlsId.startsWith('content-received-')) {
    btn.textContent = isHidden ? (t('historyShowReceivedData') || 'AIから受信したデータ') : (t('historyHideReceivedData') || 'データを非表示');
  } else {
    btn.textContent = isHidden ? t('historyShowContent') : t('historyHideContent');
  }
}

function updateBulkBar(
  container: HTMLElement,
  selectedIds: Set<number>,
  entries: BrowsingLogEntry[],
): void {
  const bar = queryById<HTMLElement>(container, SQLITE_HISTORY_IDS.bulkBar);
  const selectAll = queryById<HTMLInputElement>(container, SQLITE_HISTORY_IDS.selectAll);
  const countEl = queryById<HTMLElement>(container, SQLITE_HISTORY_IDS.selectionCount);
  const appendBtn = queryById<HTMLButtonElement>(container, SQLITE_HISTORY_IDS.appendObsidian);

  if (bar) {
    // .hidden uses `!important` (dashboard.css), so an inline display
    // override alone cannot show the bar again — the class must be toggled.
    bar.classList.toggle('hidden', selectedIds.size === 0);
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

function updateTagFilterBar(
  containerEl: HTMLElement,
  activeTagFilter: string | null,
  pendingTagFallback: SqliteHistoryState['pendingTagFallback'],
  onClear: () => void,
): void {
  const existingBar = queryById<HTMLElement>(containerEl, SQLITE_HISTORY_IDS.tagFilterBar);
  if (activeTagFilter || pendingTagFallback) {
    if (!existingBar) {
      const bar = document.createElement('div');
      bar.id = SQLITE_HISTORY_IDS.tagFilterBar;
      bar.className = 'sqlite-tag-filter-bar';
      bar.setAttribute('role', 'status');
      bar.innerHTML = `
        <span data-i18n="tagFilterLabel">フィルター:</span>
         <span class="tag-filter-badge">#${escapeHtml(activeTagFilter || pendingTagFallback?.tag || '')}</span>
        <button type="button" id="${SQLITE_HISTORY_IDS.tagFilterClear}" class="tag-filter-clear" aria-label="${t('clearTagFilter') || 'Clear tag filter'}">✕</button>`;
      containerEl.appendChild(bar);
      const clearBtn = queryById<HTMLButtonElement>(bar, SQLITE_HISTORY_IDS.tagFilterClear);
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

/** Builds region HTML and wires listeners. No-op when the region is absent. */
export function wireEntryList(
  container: HTMLElement,
  entries: BrowsingLogEntry[],
  selectedIds: Set<number>,
  activeTagFilter: string | null,
  callbacks: Pick<SqliteHistoryViewCallbacks,
    'onToggleStar' | 'onDelete' | 'onSelectionChange' | 'onTagFilterClick' | 'onContentToggle' | 'createCopyButton'>,
): void {
  const region = queryById<HTMLElement>(container, SQLITE_HISTORY_IDS.entryList);
  if (!region) return;
  region.innerHTML = buildEntryListHtml(entries, selectedIds, activeTagFilter);

  if (entries.length === 0) return;

  // Set progress bar widths from data attributes (CSP-safe: no inline styles)
  region.querySelectorAll<HTMLElement>('.cleansing-progress-bar[data-bar-width]').forEach((bar) => {
    bar.style.width = `${bar.getAttribute('data-bar-width')}%`;
  });

  region.querySelectorAll('[data-action="select"]').forEach((el) => {
    const id = Number((el as HTMLElement).getAttribute('data-id'));
    el.addEventListener('change', () => {
      const checkbox = el as HTMLInputElement;
      callbacks.onSelectionChange(id, checkbox.checked);
    });
  });
  region.querySelectorAll('[data-action="star"]').forEach((el) => {
    const entryId = Number((el as HTMLElement).closest('.sqlite-entry')?.getAttribute('data-id'));
    if (entryId) el.addEventListener('click', () => callbacks.onToggleStar(entryId));
  });
  region.querySelectorAll('[data-action="delete"]').forEach((el) => {
    const entryId = Number((el as HTMLElement).closest('.sqlite-entry')?.getAttribute('data-id'));
    if (entryId) el.addEventListener('click', () => callbacks.onDelete(entryId));
  });

  entries.forEach(entry => {
    const entryEl = region.querySelector(`.sqlite-entry[data-id="${entry.id}"] .sqlite-entry-header`);
    if (entryEl) {
      entryEl.appendChild(callbacks.createCopyButton(entry));
    }
  });

  region.querySelectorAll('[data-action="content-toggle"]').forEach((el) => {
    el.addEventListener('click', () => {
      const controlsId = el.getAttribute('aria-controls');
      if (!controlsId) return;
      callbacks.onContentToggle(controlsId);
    });
  });

  region.querySelectorAll('[data-action="tag-filter"]').forEach((el) => {
    el.addEventListener('click', () => {
      const tag = (el as HTMLElement).getAttribute('data-tag');
      if (!tag) return;
      callbacks.onTagFilterClick(tag);
    });
  });
}

/** Builds pagination HTML and wires prev/next. No-op when the region is absent. */
export function wirePagination(
  container: HTMLElement,
  currentPage: number,
  total: number,
  pageSize: number,
  callbacks: Pick<SqliteHistoryViewCallbacks, 'onPageChange'>,
): void {
  const region = queryById<HTMLElement>(container, SQLITE_HISTORY_IDS.pagination);
  if (!region) return;
  region.innerHTML = buildPaginationHtml(currentPage, total, pageSize);
  if (!region.innerHTML) return;

  region.querySelector('[data-page="prev"]')?.addEventListener('click', () => callbacks.onPageChange(currentPage - 1));
  region.querySelector('[data-page="next"]')?.addEventListener('click', () => callbacks.onPageChange(currentPage + 1));
}

/** Builds sort-control HTML and wires the select. No-op when the region is absent. */
export function wireSortControl(
  container: HTMLElement,
  sortBy: SqliteHistoryState['sortBy'],
  sortDir: SqliteHistoryState['sortDir'],
  hasActiveSearch: boolean,
  callbacks: Pick<SqliteHistoryViewCallbacks, 'onSortChange'>,
): void {
  const region = queryById<HTMLElement>(container, SQLITE_HISTORY_IDS.sortControl);
  if (!region) return;
  region.innerHTML = buildSortControlHtml(sortBy, sortDir, hasActiveSearch);

  const select = queryById<HTMLSelectElement>(region, SQLITE_HISTORY_IDS.sortSelect);
  select?.addEventListener('change', () => {
    const parsed = parseSortSelectValue(select.value);
    callbacks.onSortChange(parsed.sortBy, parsed.sortDir);
  });
}

/** Builds calendar-nav HTML and wires date/month/clear actions. No-op when absent. */
export function wireCalendarNav(
  container: HTMLElement,
  selectedDate: string | null,
  options: { searchQuery: string; activeTagFilter: string | null },
  callbacks: Pick<SqliteHistoryViewCallbacks, 'onDateSelect' | 'onRangeSelect' | 'onClearFilters'>,
): void {
  const region = queryById<HTMLElement>(container, SQLITE_HISTORY_IDS.calendarNav);
  if (!region) return;
  const { html, year, month } = buildCalendarNavHtml(selectedDate, options);
  region.innerHTML = html;

  region.querySelectorAll('[data-date]').forEach(el => {
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

  region.querySelector('[data-month-prev]')?.addEventListener('click', () => {
    const d = new Date(year, month - 1, 1);
    callbacks.onDateSelect(formatDate(d));
  });
  region.querySelector('[data-month-next]')?.addEventListener('click', () => {
    const d = new Date(year, month + 1, 1);
    callbacks.onDateSelect(formatDate(d));
  });

  region.querySelector(`#${SQLITE_HISTORY_IDS.clearAllFilters}`)?.addEventListener('click', () => {
    const searchInput = queryById<HTMLInputElement>(container, SQLITE_HISTORY_IDS.searchInput);
    if (searchInput) searchInput.value = '';
    callbacks.onClearFilters();
  });

  const daysEl = queryById<HTMLElement>(region, SQLITE_HISTORY_IDS.calendarDays);
  if (!daysEl) return;

  daysEl.innerHTML = buildCalendarDaysHtml(year, month, selectedDate);

  daysEl.querySelectorAll('.day:not(.empty)').forEach(el => {
    el.addEventListener('click', () => {
      callbacks.onDateSelect((el as HTMLElement).dataset.date!);
    });
  });
}

/** Wires shell-level controls created by buildPanelShellHtml (search + bulk bar). */
export function wirePanelShell(
  container: HTMLElement,
  state: SqliteHistoryState,
  callbacks: Pick<SqliteHistoryViewCallbacks, 'onSearchInput' | 'onSelectAll' | 'onClearSelection' | 'onAppend'>,
  options: { focusSearch?: boolean } = {},
): void {
  const searchInput = queryById<HTMLInputElement>(container, SQLITE_HISTORY_IDS.searchInput);
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      callbacks.onSearchInput(searchInput.value);
    });
    if (options.focusSearch) searchInput.focus();
  }

  const selectAllCheckbox = queryById<HTMLInputElement>(container, SQLITE_HISTORY_IDS.selectAll);
  const clearSelectionBtn = queryById<HTMLButtonElement>(container, SQLITE_HISTORY_IDS.clearSelection);
  const appendBtn = queryById<HTMLButtonElement>(container, SQLITE_HISTORY_IDS.appendObsidian);

  if (selectAllCheckbox) {
    selectAllCheckbox.checked = state.selectedIds.size > 0 && state.selectedIds.size === state.entries.length;
    selectAllCheckbox.addEventListener('change', () => {
      callbacks.onSelectAll(selectAllCheckbox.checked);
    });
  }

  if (clearSelectionBtn) {
    clearSelectionBtn.addEventListener('click', () => {
      callbacks.onClearSelection();
    });
  }

  if (appendBtn) {
    appendBtn.addEventListener('click', () => callbacks.onAppend());
  }
}

/** Full rebuild: shell + all regions + shell wiring. */
function renderFull(
  container: HTMLElement,
  state: SqliteHistoryState,
  callbacks: SqliteHistoryViewCallbacks,
): void {
  container.innerHTML = buildPanelShellHtml(state, callbacks.translateError);

  if (!state.loading) {
    wireCalendarNav(container, state.selectedDate,
      { searchQuery: state.searchQuery, activeTagFilter: state.activeTagFilter },
      callbacks);
    wireSortControl(container, state.sortBy, state.sortDir, isFullTextSearchActive(state), callbacks);
    wireEntryList(container, state.entries, state.selectedIds, state.activeTagFilter, callbacks);
    wirePagination(container, state.currentPage, state.total, SQLITE_HISTORY_PAGE_SIZE, callbacks);
  }

  wirePanelShell(container, state, callbacks, { focusSearch: true });
}

/**
 * Diff update onto the mounted shell: count, search sync, error, tag bar,
 * calendar / sort / list / pagination regions, bulk bar. Listeners inside
 * re-rendered regions are rewired by the wireXxx calls; shell-level
 * listeners (search input, bulk bar buttons) are left untouched so focus
 * and input state survive.
 */
function updateDynamicRegions(
  container: HTMLElement,
  state: SqliteHistoryState,
  callbacks: SqliteHistoryViewCallbacks,
): void {
  const countEl = container.querySelector('.sqlite-history-count');
  if (countEl) countEl.textContent = t(getPluralKey('historyRecordCount', state.total), [String(state.total)]);

  // Keep the search input value in sync with state.searchQuery, which may
  // have been set by a tag-fallback full-text search or cleared by a filter
  // action. Without this, the input stays stale after non-renderFull
  // refresh paths (updateDynamicRegions).
  const searchInputEl = queryById<HTMLInputElement>(container, SQLITE_HISTORY_IDS.searchInput);
  if (searchInputEl && searchInputEl.value !== state.searchQuery) {
    searchInputEl.value = state.searchQuery;
  }

  const errorEl = queryById<HTMLElement>(container, SQLITE_HISTORY_IDS.error);
  if (errorEl) {
    errorEl.textContent = callbacks.translateError(state.error);
    errorEl.classList.toggle('hidden', !state.error);
    errorEl.style.display = state.error ? '' : 'none';
  }

  const searchArea = container.querySelector('.sqlite-history-search');
  if (searchArea) {
    updateTagFilterBar(
      searchArea as HTMLElement,
      state.activeTagFilter,
      state.pendingTagFallback,
      callbacks.onTagFilterClear,
    );
  }

  wireCalendarNav(container, state.selectedDate,
    { searchQuery: state.searchQuery, activeTagFilter: state.activeTagFilter },
    callbacks);

  wireSortControl(
    container,
    state.sortBy,
    state.sortDir,
    isFullTextSearchActive(state),
    callbacks,
  );

  const listRegion = queryById<HTMLElement>(container, SQLITE_HISTORY_IDS.entryList);
  if (listRegion) {
    if (state.loading) {
      listRegion.innerHTML = `<div class="loading">${t('historyLoading')}</div>`;
    } else {
      wireEntryList(container, state.entries, state.selectedIds, state.activeTagFilter, callbacks);
    }
  }

  if (!state.loading) {
    wirePagination(container, state.currentPage, state.total, SQLITE_HISTORY_PAGE_SIZE, callbacks);
  }

  updateBulkBar(container, state.selectedIds, state.entries);
}
