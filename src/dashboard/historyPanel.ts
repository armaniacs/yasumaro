import { getSavedUrlEntries } from '../utils/storageUrls.js';
import { getPendingPages } from '../utils/pendingStorage.js';
import { createInitialState } from './historyState.js';
import type { HistoryPanelState, HistoryElements, TagEditElements } from './historyState.js';
import { renderHistoryEntries } from './historyRenderer.js';
import { renderSkippedMode, renderPendingPage } from './historyPendingPanel.js';
import { updateTagFilterIndicator } from './historyFilters.js';
import { initTagEditModal, saveTagEdits } from './historyTagEditModal.js';
import { updateCleansingStatsPanel } from './historyCleansingSync.js';

export { showRecordError, checkServiceWorkerAlive } from './historyUtils.js';

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

  const onTagFilterChange = (): void => {
    applyFilters(false);
    updateTagFilterIndicator(state, () => {
      state.activeTagFilter = null;
      state.historyCurrentPage = 0;
      applyFilters(false);
      updateTagFilterIndicator(state, () => { /* no-op: already cleared */ });
    });
  };

  function applyFilters(resetPage = true): void {
    if (!historyList) return;

    const searchText = (historySearchInput?.value || '').toLowerCase();

    if (state.activeFilter === 'skipped') {
      renderSkippedMode(state, elements, searchText, applyFilters);
      return;
    }

    if (resetPage) state.historyCurrentPage = 0;

    renderHistoryEntries(state, elements, tagEditElements, searchText, onTagFilterChange, applyFilters);
    updateCleansingStatsPanel(state.entries);
  }

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

    Promise.all(updatePromises).then(() => applyFilters());
  };
  chrome.storage.onChanged.addListener(onStorageChanged);

  document.addEventListener('navigate-to-tag', (e: Event) => {
    const tag = (e as CustomEvent<string>).detail;
    state.activeTagFilter = tag;
    state.activeFilter = 'all';
    state.historyCurrentPage = 0;
    document.querySelectorAll<HTMLButtonElement>('.sidebar-nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll<HTMLElement>('.panel').forEach(p => p.classList.remove('active'));
    document.querySelector<HTMLButtonElement>('[data-panel="panel-history"]')?.classList.add('active');
    document.getElementById('panel-history')?.classList.add('active');
    applyFilters(false);
    updateTagFilterIndicator(state, () => {
      state.activeTagFilter = null;
      state.historyCurrentPage = 0;
      applyFilters(false);
    });
  });

  historySearchInput?.addEventListener('input', () => {
    state.activeTagFilter = null;
    updateTagFilterIndicator(state, () => { /* no-op */ });
    applyFilters();
  });

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      state.activeFilter = (btn.dataset['filter'] || 'all') as typeof state.activeFilter;
      state.activeTagFilter = null;
      updateTagFilterIndicator(state, () => { /* no-op */ });
      applyFilters();
    });
  });

  initTagEditModal(state, tagEditElements, () => applyFilters(false));

  if (!pendingSection || !pendingList) {
    applyFilters();
    updateCleansingStatsPanel(state.entries);
    return;
  }

  if (state.pendingPages.length === 0) {
    pendingSection.hidden = true;
  } else {
    pendingSection.hidden = false;
    const sortedPending = [...state.pendingPages].sort((a, b) => b.timestamp - a.timestamp);
    const pendingCurrentPageRef = { value: 0 };
    renderPendingPage(state, elements, pendingSection, pendingList, sortedPending, pendingCurrentPageRef, applyFilters);
  }

  applyFilters();
  updateCleansingStatsPanel(state.entries);
}

export { initHistoryPanel };
