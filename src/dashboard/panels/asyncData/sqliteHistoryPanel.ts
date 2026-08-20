import { getMessageOr } from '../../../utils/i18n.js';
import type { BrowsingLogEntry } from './sqliteHistoryQuery.js';
import { showConfirmDialog } from '../../utils/confirmDialog.js';
import { formatEntryToMarkdown } from '../../../utils/markdownFormatter.js';
import { copyTextToClipboard } from '../../../utils/clipboard.js';
import { type PanelLifecycle } from '../types.js';
import { getPluralKey } from '../../../utils/i18nPlural.js';
import { escapeHtml } from '../../../utils/htmlEscape.js';
import type { SqliteHistoryState } from './sqliteHistoryPanelState.js';
import { createSqliteHistoryController } from './sqliteHistoryPanelController.js';
import { notify } from '../../notificationService.js';
import {
  formatDiagnosticMetadataHtml,
  isFullTextSearchActive,
  parseSortSelectValue,
  buildEntryListHtml,
  buildPaginationHtml,
  buildSortControlHtml,
  buildCalendarNavHtml,
  buildCalendarDaysHtml,
  buildPanelShellHtml,
  formatDate,
} from './sqliteHistoryPanelView.js';

export { formatDiagnosticMetadataHtml };

const PAGE_SIZE = 20;

function t(key: string, substitutions?: string | string[]): string {
  return getMessageOr(key, key, substitutions);
}

export function createSqliteHistoryPanel(): PanelLifecycle {
  let container: HTMLElement | null = null;
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let _isMounted = false;

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
    _container.innerHTML = buildEntryListHtml(entries, selectedIds, activeTagFilter);

    if (entries.length === 0) return;

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

    entries.forEach(entry => {
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
    _container.innerHTML = buildPaginationHtml(currentPage, total, pageSize);
    if (!_container.innerHTML) return;

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
    _container.innerHTML = buildSortControlHtml(sortBy, sortDir, hasActiveSearch);

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
    const { html, year, month } = buildCalendarNavHtml(selectedDate, options);
    _container.innerHTML = html;

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

    daysEl.innerHTML = buildCalendarDaysHtml(year, month, selectedDate);

    daysEl.querySelectorAll('.day:not(.empty)').forEach(el => {
      el.addEventListener('click', () => {
        callbacks.onDateSelect((el as HTMLElement).dataset.date!);
      });
    });
  }

  function renderState(): void {
    if (!container) return;
    const s = state();

    container.innerHTML = buildPanelShellHtml(s, translateHistoryError);

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
    init(initParams?: Record<string, unknown>) {
      if (initParams?.searchTag) {
        controller.activateWithTag(initParams.searchTag as string);
      } else if (initParams?.searchDomain) {
        controller.activateWithDomain(initParams.searchDomain as string);
      }
    },
    async load() {
      if (!container) return;

      _isMounted = true;
      await controller.checkFallbackStatus();
      await controller.loadPersistedSortIntoState();

      renderState();

      // Consume any init params set by init() (which runs before load())
      // so retryInitialLoad uses the correct search/tag parameters.
      const fetchOpts = controller.consumePendingInit();
      void controller.retryInitialLoad(fetchOpts ?? { limit: PAGE_SIZE });
    },
    destroy() {
      if (searchDebounceTimer !== null) {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = null;
      }
      _isMounted = false;
      controller.bumpGenerationOnUnmount();
      // Clear bulk bar listener references
      controller.clearEntrySelection();
    },
  };
}
