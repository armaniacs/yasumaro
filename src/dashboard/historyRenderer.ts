import { getMessage } from '../popup/i18n.js';
import { getFilteredEntries } from './historyFilters.js';
import { makeHistoryEntryRow } from './historyEntryRow.js';
import { createPaginationControls } from './historyUtils.js';
import type { HistoryPanelState, HistoryElements, TagEditElements } from './historyState.js';
import { HISTORY_PAGE_SIZE } from './historyState.js';

export function renderHistoryEntries(
  state: HistoryPanelState,
  elements: HistoryElements,
  tagEditElements: TagEditElements,
  searchText: string,
  onTagFilterChange: () => void,
  onApplyFilters: (resetPage?: boolean) => void,
): void {
  if (!elements.historyList) return;

  const filtered = getFilteredEntries(
    state.entries,
    state.activeFilter,
    state.activeTagFilter,
    searchText,
  );

  const totalPages = Math.ceil(filtered.length / HISTORY_PAGE_SIZE);
  if (state.historyCurrentPage >= totalPages && state.historyCurrentPage > 0) {
    state.historyCurrentPage = totalPages - 1;
  }

  if (elements.historyStats) {
    elements.historyStats.textContent = `${filtered.length} / ${state.entries.length}`;
  }

  if (filtered.length === 0) {
    elements.historyList.innerHTML = `<div class="history-empty">${getMessage('historyEmpty') || 'No history found.'}</div>`;
    return;
  }

  const start = state.historyCurrentPage * HISTORY_PAGE_SIZE;
  const pageItems = filtered.slice(start, start + HISTORY_PAGE_SIZE);

  const fragment = document.createDocumentFragment();
  pageItems.forEach((entry, index) => {
    fragment.appendChild(
      makeHistoryEntryRow(entry, index, start, state, tagEditElements, onTagFilterChange, onApplyFilters),
    );
  });

  if (totalPages > 1) {
    const nav = createPaginationControls(
      state.historyCurrentPage,
      totalPages,
      (newPage) => { state.historyCurrentPage = newPage; onApplyFilters(false); },
    );
    fragment.appendChild(nav);
  }

  elements.historyList.innerHTML = '';
  elements.historyList.appendChild(fragment);
}
