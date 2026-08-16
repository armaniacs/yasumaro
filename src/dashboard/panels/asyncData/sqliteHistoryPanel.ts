import { getMessageOr } from '../../../utils/i18n.js';
import type { BrowsingLogEntry } from './sqliteHistoryQuery.js';
import { showConfirmDialog } from '../../utils/confirmDialog.js';
import { formatEntryToMarkdown } from '../../../utils/markdownFormatter.js';
import { copyTextToClipboard } from '../../../utils/clipboard.js';
import { parseTagsForDisplay } from '../../../utils/tagUtils.js';
import { isSecureUrl } from '../../../utils/urlUtils.js';
import { type AsyncDataPanel } from '../types.js';
import { getPluralKey } from '../../../utils/i18nPlural.js';
import { escapeHtml } from '../../../utils/htmlEscape.js';
import type { SqliteHistoryState } from './sqliteHistoryPanelState.js';
import { createSqliteHistoryController } from './sqliteHistoryPanelController.js';

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

function sortSelectValue(sortBy: SqliteHistoryState['sortBy'], sortDir: SqliteHistoryState['sortDir']): string {
  return `${sortBy}:${sortDir}`;
}

function parseSortSelectValue(value: string): { sortBy: SqliteHistoryState['sortBy']; sortDir: SqliteHistoryState['sortDir'] } {
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
function isFullTextSearchActive(state: SqliteHistoryState): boolean {
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

export function createSqliteHistoryPanel(): AsyncDataPanel {
  let container: HTMLElement | null = null;
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let isMounted = false;

  const controller = createSqliteHistoryController({
    onStateChange: () => refresh(),
  });

  function state(): SqliteHistoryState {
    return controller.getState();
  }

  /** Translate a loadFailure error: an i18n key (from the controller) or a raw "Error: ..." string. */
  function translateHistoryError(error: string | null): string {
    if (!error) return '';
    return error.startsWith('Error: ') ? error : t(error);
  }

  function isPanelMounted(): boolean {
    return document.getElementById('sqlite-search-input') !== null;
  }

  async function handleToggleStar(id: number): Promise<void> {
    await controller.toggleStar(id);
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
    await controller.deleteEntry(id);
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
        button.textContent = '✓';
        button.setAttribute('aria-label', t('copyMarkdownSuccess') || 'Copied to clipboard');
        setTimeout(() => {
          button.textContent = originalIcon;
          button.setAttribute('aria-label', t('copyMarkdown') || 'Copy Markdown');
          button.disabled = false;
        }, 2000);
      } catch {
        button.textContent = '✗';
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

  async function handleAppendToObsidian(): Promise<void> {
    const result = await controller.appendSelectedToObsidian();
    if (!result) return;

    if (result.success) {
      chrome.notifications?.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('/icons/icon48.png'),
        title: t('historyAppendToObsidian'),
        message: t(getPluralKey('historyAppendSuccess', result.appendedCount), [String(result.appendedCount)]),
      });
      return;
    }

    chrome.notifications?.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('/icons/icon48.png'),
      title: t('historyAppendToObsidian'),
      message: `${t('historyAppendFailed')}: ${result.error}`,
    });
  }

  function handleContentToggle(controlsId: string): void {
    const area = document.getElementById(controlsId);
    if (!area) return;
    const isHidden = area.classList.toggle('hidden');
    const btn = document.querySelector(`[aria-controls="${controlsId}"]`) as HTMLButtonElement | null;
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

  const bulkCallbacks = {
    onSelectAll: (checked: boolean) => {
      controller.selectAllEntries(checked);
    },
    onClear: () => {
      controller.clearEntrySelection();
    },
    onAppend: () => {
      void handleAppendToObsidian();
    },
  };

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
          <span data-i18n="tagFilterLabel">フィルター:</span>
           <span class="tag-filter-badge">#${escapeHtml(activeTagFilter || pendingTagFallback?.tag || '')}</span>
          <button type="button" id="sqlite-tag-filter-clear" class="tag-filter-clear" aria-label="${t('clearTagFilter') || 'Clear tag filter'}">✕</button>`;
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
    const s = state();
    const countEl = container?.querySelector('.sqlite-history-count');
    if (countEl) countEl.textContent = t(getPluralKey('historyRecordCount', s.total), [String(s.total)]);

    // Keep the search input value in sync with state.searchQuery, which may
    // have been set by a tag-fallback full-text search or cleared by a filter
    // action.  Without this, the input stays stale after non-renderState
    // refresh paths (updateDynamicRegions).
    const searchInputEl = document.getElementById('sqlite-search-input') as HTMLInputElement | null;
    if (searchInputEl && searchInputEl.value !== s.searchQuery) {
      searchInputEl.value = s.searchQuery;
    }

    const errorEl = document.getElementById('sqlite-error');
    if (errorEl) {
      errorEl.textContent = translateHistoryError(s.error);
      errorEl.classList.toggle('hidden', !s.error);
      (errorEl as HTMLElement).style.display = s.error ? '' : 'none';
    }

    const searchArea = container?.querySelector('.sqlite-history-search');
    if (searchArea) {
      updateTagFilterBar(
        searchArea as HTMLElement,
        s.activeTagFilter,
        s.pendingTagFallback,
        () => controller.clearTagFilter(),
      );
    }

    const calContainer = document.getElementById('sqlite-calendar-nav');
    if (calContainer) {
      renderCalendarNav(calContainer, s.selectedDate,
        { searchQuery: s.searchQuery, activeTagFilter: s.activeTagFilter },
        {
          onDateSelect: (d) => void controller.selectDate(d),
          onRangeSelect: (since, until) => controller.selectDateRange(since, until),
          onClearFilters: () => controller.clearAllFilters(),
        }
      );
    }

    const sortContainer = document.getElementById('sqlite-sort-control');
    if (sortContainer) {
      renderSortControl(
        sortContainer,
        s.sortBy,
        s.sortDir,
        isFullTextSearchActive(s),
        (sortBy, sortDir) => void controller.changeSort(sortBy, sortDir),
      );
    }

    const listContainer = document.getElementById('sqlite-entry-list');
    if (listContainer) {
      if (s.loading) {
        listContainer.innerHTML = `<div class="loading">${t('historyLoading')}</div>`;
      } else {
        renderEntryList(listContainer, s.entries, s.selectedIds, s.activeTagFilter, {
          onToggleStar: (id) => void handleToggleStar(id),
          onDelete: (id) => void handleDelete(id),
          onSelectionChange: (id, selected) => controller.selectEntry(id, selected),
          onTagFilterClick: (tag) => controller.filterByTag(tag),
          onContentToggle: (controlsId) => handleContentToggle(controlsId),
        });
      }
    }

    if (!s.loading) {
      const pagContainer = document.getElementById('sqlite-pagination');
      if (pagContainer) renderPagination(pagContainer, s.currentPage, s.total, PAGE_SIZE, (page) => controller.changePage(page));
    }

    updateBulkBar(s.selectedIds, s.entries);
  }

  const debouncedSearch = (() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (query: string) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        controller.search(query);
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

  function renderSortControl(
    _container: HTMLElement,
    sortBy: SqliteHistoryState['sortBy'],
    sortDir: SqliteHistoryState['sortDir'],
    hasActiveSearch: boolean,
    onChange: (sortBy: SqliteHistoryState['sortBy'], sortDir: SqliteHistoryState['sortDir']) => void,
  ): void {
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

    _container.innerHTML = `
      <label class="sqlite-sort-label" for="sqlite-sort-select">${t('historySortLabel') || '並び替え'}</label>
      <select id="sqlite-sort-select" aria-label="${t('historySortLabel') || '並び替え'}">
        ${options.map(o => `<option value="${o.value}"${o.value === safeValue ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
      </select>
    `;

    const select = _container.querySelector('#sqlite-sort-select') as HTMLSelectElement | null;
    select?.addEventListener('change', () => {
      const parsed = parseSortSelectValue(select.value);
      onChange(parsed.sortBy, parsed.sortDir);
    });
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
        ${hasActiveFilters ? `<button type="button" id="sqlite-clear-all-filters" class="sqlite-clear-filters-btn" aria-label="${t('clearAllFilters') || 'Clear all filters'}">${t('clearAllFilters') || '条件をクリア'}</button>` : ''}
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
    const s = state();

    const fallbackBanner = s.fallbackMode
      ? `<div class="sqlite-fallback-warning warning-banner" role="alert">
          ⚠️ ${t('fallbackStorageWarning')}
         </div>`
      : '';

    container.innerHTML = `
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

    if (!s.loading) {
      const calContainer = document.getElementById('sqlite-calendar-nav');
      if (calContainer) {
        renderCalendarNav(calContainer, s.selectedDate,
          { searchQuery: s.searchQuery, activeTagFilter: s.activeTagFilter },
          {
            onDateSelect: (d) => void controller.selectDate(d),
            onRangeSelect: (since, until) => controller.selectDateRange(since, until),
            onClearFilters: () => controller.clearAllFilters(),
          }
        );
      }

      const sortContainer = document.getElementById('sqlite-sort-control');
      if (sortContainer) {
        renderSortControl(
          sortContainer,
          s.sortBy,
          s.sortDir,
          isFullTextSearchActive(s),
          (sortBy, sortDir) => void controller.changeSort(sortBy, sortDir),
        );
      }

      const listContainer = document.getElementById('sqlite-entry-list');
      if (listContainer) {
        renderEntryList(listContainer, s.entries, s.selectedIds, s.activeTagFilter, {
          onToggleStar: (id) => void handleToggleStar(id),
          onDelete: (id) => void handleDelete(id),
          onSelectionChange: (id, selected) => controller.selectEntry(id, selected),
          onTagFilterClick: (tag) => controller.filterByTag(tag),
          onContentToggle: (controlsId) => handleContentToggle(controlsId),
        });
      }

      const pagContainer = document.getElementById('sqlite-pagination');
      if (pagContainer) renderPagination(pagContainer, s.currentPage, s.total, PAGE_SIZE, (page) => controller.changePage(page));
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
      selectAllCheckbox.checked = s.selectedIds.size > 0 && s.selectedIds.size === s.entries.length;
      selectAllCheckbox.addEventListener('change', () => {
        bulkCallbacks.onSelectAll(selectAllCheckbox.checked);
      });
    }

    if (clearSelectionBtn) {
      clearSelectionBtn.addEventListener('click', () => {
        bulkCallbacks.onClear();
      });
    }

    if (appendBtn) {
      appendBtn.addEventListener('click', () => bulkCallbacks.onAppend());
    }
  }

  function refresh(): void {
    if (isPanelMounted()) {
      updateDynamicRegions();
    } else {
      renderState();
    }
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
      await controller.checkFallbackStatus();
      await controller.loadPersistedSortIntoState();

      renderState();

      // Consume any init params set by onActivate (which runs before loadData)
      // so retryInitialLoad uses the correct search/tag parameters.
      const fetchOpts = controller.consumePendingInit();
      void controller.retryInitialLoad(fetchOpts ?? { limit: PAGE_SIZE });
    },
    unmount() {
      if (searchDebounceTimer !== null) {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = null;
      }
      isMounted = false;
      controller.bumpGenerationOnUnmount();
      // Clear bulk bar listener references
      controller.clearEntrySelection();
    },
    onActivate(init) {
      if (init?.searchTag) {
        controller.activateWithTag(init.searchTag as string);
      } else if (init?.searchDomain) {
        controller.activateWithDomain(init.searchDomain as string);
      }
    },
  };
}
