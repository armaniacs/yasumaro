import { getSavedUrlEntries } from '../utils/storageUrls.js';
import { getPendingPages } from '../utils/pendingStorage.js';
import { createInitialState } from './historyState.js';
import type { HistoryPanelState, HistoryElements, TagEditElements } from './historyState.js';
import { renderHistoryEntries } from './historyRenderer.js';
import { renderSkippedMode, renderPendingPage } from './historyPendingPanel.js';
import { updateTagFilterIndicator } from './historyFilters.js';
import { initTagEditModal, saveTagEdits } from './historyTagEditModal.js';
import { updateCleansingStatsPanel } from './historyCleansingSync.js';
import { searchForTagInSqliteHistory } from './sqliteHistoryPanel.js';

export { showRecordError, checkServiceWorkerAlive } from './historyUtils.js';

// Module-level state shared across all event handlers
let historyPanelState: HistoryPanelState | null = null;
let historyPanelElements: HistoryElements | null = null;
let applyFiltersFunc: ((resetPage?: boolean) => void) | null = null;

export function getHistoryPanelState(): HistoryPanelState | null {
  return historyPanelState;
}

async function initHistoryPanel(): Promise<void> {
  const historySearchInput = document.getElementById('historySearch') as HTMLInputElement | null;
  const historyList = document.getElementById('historyList') as HTMLElement | null;
  const historyStats = document.getElementById('historyStats') as HTMLElement | null;
  const pendingSection = document.getElementById('pendingSection') as HTMLElement | null;
  const pendingList = document.getElementById('pendingList') as HTMLElement | null;
  const filterBtns = document.querySelectorAll<HTMLButtonElement>('.history-filter-btn');

  const tagEditModal = document.getElementById('tagEditModal') as HTMLElement | null;
  const closeTagEditModalBtn = document.getElementById('closeTagEditModalBtn') as HTMLButtonElement | null;
  const tagEditUrl = document.getElementById('tagEditUrl') as HTMLElement | null;
  const currentTagsList = document.getElementById('currentTagsList') as HTMLElement | null;
  const noCurrentTagsMsg = document.getElementById('noCurrentTagsMsg') as HTMLElement | null;
  const tagCategorySelect = document.getElementById('tagCategorySelect') as HTMLSelectElement | null;
  const addTagBtn = document.getElementById('addTagBtn') as HTMLButtonElement | null;
  const saveTagEditsBtn = document.getElementById('saveTagEditsBtn') as HTMLButtonElement | null;

  if (!historyList) return;

  const elements: HistoryElements = {
    historyList,
    historyStats,
    historySearchInput,
    pendingSection,
    pendingList,
    filterBtns,
  };

  const tagEditElements: TagEditElements = {
    tagEditModal,
    closeTagEditModalBtn,
    tagEditUrl,
    currentTagsList,
    noCurrentTagsMsg,
    tagCategorySelect,
    addTagBtn,
    saveTagEditsBtn,
  };

  const rawEntries = await getSavedUrlEntries();
  const pendingPages = await getPendingPages();

  const state: HistoryPanelState = createInitialState();
  state.entries = rawEntries.slice().sort((a, b) => b.timestamp - a.timestamp);
  state.pendingPages = pendingPages;
  pendingPages.forEach(p => state.pendingUrlSet.add(p.url));

  // Store in module-level variable for external access
  historyPanelState = state;
  historyPanelElements = elements;

  const onTagFilterChange = (): void => {
    applyFiltersInternal(false);
    updateTagFilterIndicator(state, () => {
      state.activeTagFilter = null;
      state.historyCurrentPage = 0;
      applyFiltersInternal(false);
      updateTagFilterIndicator(state, () => { /* no-op: already cleared */ });
    });
  };

  function applyFiltersInternal(resetPage = true): void {
    if (!historyList) return;

    const searchText = (historySearchInput?.value || '').toLowerCase();

    if (state.activeFilter === 'skipped') {
      renderSkippedMode(state, elements, searchText, applyFiltersInternal);
      return;
    }

    if (resetPage) state.historyCurrentPage = 0;

    renderHistoryEntries(state, elements, tagEditElements, searchText, onTagFilterChange, applyFiltersInternal);
    updateCleansingStatsPanel(state.entries);
  }

  // Store for external access
  applyFiltersFunc = applyFiltersInternal;

  const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    if (area !== 'local') return;

    const savedChanged = 'savedUrlsWithTimestamps' in changes;
    const pendingChanged = 'osh_pending_pages' in changes;
    if (!savedChanged && !pendingChanged) return;

    const updatePromises: Promise<void>[] = [];

    if (savedChanged) {
      updatePromises.push(
        getSavedUrlEntries().then(updated => {
          state.entries = updated.slice().sort((a, b) => b.timestamp - a.timestamp);
        }),
      );
    }

    if (pendingChanged) {
      updatePromises.push(
        getPendingPages().then(updated => {
          state.pendingPages.length = 0;
          state.pendingPages.push(...updated);
          state.pendingUrlSet.clear();
          updated.forEach(p => state.pendingUrlSet.add(p.url));
        }),
      );
    }

    Promise.all(updatePromises).then(() => applyFiltersInternal());
  };
  chrome.storage.onChanged.addListener(onStorageChanged);

  historySearchInput?.addEventListener('input', () => {
    state.activeTagFilter = null;
    updateTagFilterIndicator(state, () => { /* no-op */ });
    applyFiltersInternal();
  });

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      state.activeFilter = (btn.dataset['filter'] || 'all') as typeof state.activeFilter;
      state.activeTagFilter = null;
      updateTagFilterIndicator(state, () => { /* no-op */ });
      applyFiltersInternal();
    });
  });

  initTagEditModal(state, tagEditElements, () => applyFiltersInternal(false));

  if (!pendingSection || !pendingList) {
    applyFiltersInternal();
    updateCleansingStatsPanel(state.entries);
    return;
  }

  if (state.pendingPages.length === 0) {
    pendingSection.hidden = true;
  } else {
    pendingSection.hidden = false;
    const sortedPending = [...state.pendingPages].sort((a, b) => b.timestamp - a.timestamp);
    const pendingCurrentPageRef = { value: 0 };
    renderPendingPage(state, elements, pendingSection, pendingList, sortedPending, pendingCurrentPageRef, applyFiltersInternal);
  }

  applyFiltersInternal();
  updateCleansingStatsPanel(state.entries);
}

// Public function to search for a tag from Tag Cluster
// Delegates to SQLite history panel since that's where the actual data is
export function searchForTagInHistory(tag: string): void {
  searchForTagInSqliteHistory(tag);
}

export { initHistoryPanel };
