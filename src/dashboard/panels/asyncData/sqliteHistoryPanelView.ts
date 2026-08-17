import { getMessageOr } from '../../../utils/i18n.js';
import type { BrowsingLogEntry } from './sqliteHistoryQuery.js';
import { parseTagsForDisplay } from '../../../utils/tagUtils.js';
import { isSecureUrl } from '../../../utils/urlUtils.js';
import { escapeHtml } from '../../../utils/htmlEscape.js';
import { getPluralKey } from '../../../utils/i18nPlural.js';
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
    <select id="sqlite-sort-select" aria-label="${t('historySortLabel') || '並び替え'}">
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
      ${hasActiveFilters ? `<button type="button" id="sqlite-clear-all-filters" class="sqlite-clear-filters-btn" aria-label="${t('clearAllFilters') || 'Clear all filters'}">${t('clearAllFilters') || '条件をクリア'}</button>` : ''}
    </div>
    <div class="sqlite-calendar-month">
      <button data-month-prev>&lt;</button>
      <span>${year}-${String(month + 1).padStart(2, '0')}</span>
      <button data-month-next>&gt;</button>
    </div>
    <div class="sqlite-calendar-days" id="sqlite-calendar-days"></div>
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
      <input type="text" id="sqlite-search-input"
        placeholder="${t('historySearchPlaceholder')}"
        value="${escapeHtml(s.searchQuery)}"
        aria-label="${t('historySearchAriaLabel')}" />
      <div id="sqlite-sort-control" class="sqlite-sort-control"></div>
      <div id="sqlite-calendar-nav" class="sqlite-calendar-nav"></div>
      <div id="sqlite-error" class="sqlite-history-error${s.error ? '' : ' hidden'}">
        ${escapeHtml(translateHistoryError(s.error))}
      </div>
    </div>
    <div id="sqlite-bulk-bar" class="sqlite-bulk-bar${s.selectedIds.size > 0 ? '' : ' hidden'}">
      <label class="sqlite-bulk-select-all">
        <input type="checkbox" id="sqlite-select-all" aria-label="${t('historySelectAll')}">
        <span data-i18n="historySelectAll">${t('historySelectAll')}</span>
      </label>
      <button type="button" id="sqlite-clear-selection" class="secondary-btn" data-i18n="historyClearSelection">${t('historyClearSelection')}</button>
      <span id="sqlite-selection-count" class="sqlite-selection-count" aria-live="polite">${t('historySelectionCount', [String(s.selectedIds.size)])}</span>
      <button type="button" id="sqlite-append-obsidian" class="btn-primary" data-i18n="historyAppendToObsidian">${t('historyAppendToObsidian')}</button>
    </div>
    <div id="sqlite-entry-list" class="sqlite-entry-list">
      ${s.loading ? `<div class="loading">${t('historyLoading')}</div>` : ''}
    </div>
    <div id="sqlite-pagination" class="sqlite-pagination"></div>
  `;
}
