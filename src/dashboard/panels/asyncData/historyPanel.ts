import { getSavedUrlEntries } from '../../../utils/storageUrls.js';
import { getPendingPages } from '../../../utils/pendingStorage.js';
import { createInitialState } from '../../historyState.js';
import type { HistoryPanelState, HistoryElements, TagEditElements } from '../../historyState.js';
import { renderHistoryEntries } from '../../historyRenderer.js';
import { renderSkippedMode, renderPendingPage } from '../../historyPendingPanel.js';
import { updateTagFilterIndicator } from '../../historyFilters.js';
import { initTagEditModal } from '../../historyTagEditModal.js';
import { updateCleansingStatsPanel } from '../../historyCleansingSync.js';
import { type AsyncDataPanel } from '../types.js';

export function createHistoryPanel(): AsyncDataPanel {
  let state: HistoryPanelState | null = null;
  let elements: HistoryElements | null = null;
  let tagEditElements: TagEditElements | null = null;
  let applyFiltersFunc: ((resetPage?: boolean) => void) | null = null;
  let onStorageChanged: ((changes: Record<string, chrome.storage.StorageChange>, area: string) => void) | null = null;

  return {
    id: 'panel-history',
    category: 'async-data',
    mount(container) {
      const historySearchInput = container.querySelector('#historySearch') as HTMLInputElement | null;
      const historyList = container.querySelector('#historyList') as HTMLElement | null;
      const historyStats = container.querySelector('#historyStats') as HTMLElement | null;
      const pendingSection = container.querySelector('#pendingSection') as HTMLElement | null;
      const pendingList = container.querySelector('#pendingList') as HTMLElement | null;
      const filterBtns = container.querySelectorAll<HTMLButtonElement>('.history-filter-btn');

      const tagEditModal = container.querySelector('#tagEditModal') as HTMLElement | null;
      const closeTagEditModalBtn = container.querySelector('#closeTagEditModalBtn') as HTMLButtonElement | null;
      const tagEditUrl = container.querySelector('#tagEditUrl') as HTMLElement | null;
      const currentTagsList = container.querySelector('#currentTagsList') as HTMLElement | null;
      const noCurrentTagsMsg = container.querySelector('#noCurrentTagsMsg') as HTMLElement | null;
      const tagCategorySelect = container.querySelector('#tagCategorySelect') as HTMLSelectElement | null;
      const addTagBtn = container.querySelector('#addTagBtn') as HTMLButtonElement | null;
      const saveTagEditsBtn = container.querySelector('#saveTagEditsBtn') as HTMLButtonElement | null;

      if (!historyList) return;

      elements = {
        historyList,
        historyStats,
        historySearchInput,
        pendingSection,
        pendingList,
        filterBtns,
      };

      tagEditElements = {
        tagEditModal,
        closeTagEditModalBtn,
        tagEditUrl,
        currentTagsList,
        noCurrentTagsMsg,
        tagCategorySelect,
        addTagBtn,
        saveTagEditsBtn,
      };
    },
    async loadData() {
      if (!elements?.historyList || !tagEditElements) return;

      const rawEntries = await getSavedUrlEntries();
      const pendingPages = await getPendingPages();

      const s = createInitialState();
      s.entries = rawEntries.slice().sort((a, b) => b.timestamp - a.timestamp);
      s.pendingPages = pendingPages;
      pendingPages.forEach(p => s.pendingUrlSet.add(p.url));
      state = s;

      const _state: HistoryPanelState = s;
      const _elements: HistoryElements = elements;
      const _tagEditElements: TagEditElements = tagEditElements;
      const historyList = _elements.historyList;

      const onTagFilterChange = (): void => {
        applyFiltersInternal(false);
        updateTagFilterIndicator(_state, () => {
          _state.activeTagFilter = null;
          _state.historyCurrentPage = 0;
          applyFiltersInternal(false);
          updateTagFilterIndicator(_state, () => { });
        });
      };

      function applyFiltersInternal(resetPage = true): void {
        if (!historyList) return;

        const searchText = (_elements.historySearchInput?.value || '').toLowerCase();

        if (_state.activeFilter === 'skipped') {
          renderSkippedMode(_state, _elements, searchText, applyFiltersInternal);
          return;
        }

        if (resetPage) _state.historyCurrentPage = 0;

        renderHistoryEntries(_state, _elements, _tagEditElements, searchText, onTagFilterChange, applyFiltersInternal);
        updateCleansingStatsPanel(_state.entries);
      }

      applyFiltersFunc = applyFiltersInternal as (resetPage?: boolean) => void;

      // Remove previous storage listener if re-mounting
      if (onStorageChanged) {
        chrome.storage.onChanged.removeListener(onStorageChanged);
      }

      onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
        if (area !== 'local') return;

        const savedChanged = 'savedUrlsWithTimestamps' in changes;
        const pendingChanged = 'osh_pending_pages' in changes;
        if (!savedChanged && !pendingChanged) return;

        const updatePromises: Promise<void>[] = [];

        if (savedChanged) {
          updatePromises.push(
            getSavedUrlEntries().then(updated => {
              _state.entries = updated.slice().sort((a, b) => b.timestamp - a.timestamp);
            }),
          );
        }

        if (pendingChanged) {
          updatePromises.push(
            getPendingPages().then(updated => {
              _state.pendingPages.length = 0;
              _state.pendingPages.push(...updated);
              _state.pendingUrlSet.clear();
              updated.forEach(p => _state.pendingUrlSet.add(p.url));
            }),
          );
        }

        Promise.all(updatePromises).then(() => applyFiltersInternal());
      };
      chrome.storage.onChanged.addListener(onStorageChanged);

      _elements.historySearchInput?.addEventListener('input', () => {
        _state.activeTagFilter = null;
        updateTagFilterIndicator(_state, () => { });
        applyFiltersInternal();
      });

      _elements.filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          _elements.filterBtns.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
          btn.classList.add('active');
          btn.setAttribute('aria-pressed', 'true');
          _state.activeFilter = (btn.dataset['filter'] || 'all') as typeof _state.activeFilter;
          _state.activeTagFilter = null;
          updateTagFilterIndicator(_state, () => { });
          applyFiltersInternal();
        });
      });

      initTagEditModal(_state, _tagEditElements, () => applyFiltersInternal(false));

      if (!_elements.pendingSection || !_elements.pendingList) {
        applyFiltersInternal();
        updateCleansingStatsPanel(_state.entries);
        return;
      }

      if (_state.pendingPages.length === 0) {
        _elements.pendingSection.hidden = true;
      } else {
        _elements.pendingSection.hidden = false;
        const sortedPending = [..._state.pendingPages].sort((a, b) => b.timestamp - a.timestamp);
        const pendingCurrentPageRef = { value: 0 };
        renderPendingPage(_state, _elements, _elements.pendingSection, _elements.pendingList, sortedPending, pendingCurrentPageRef, applyFiltersInternal);
      }

      applyFiltersInternal();
      updateCleansingStatsPanel(_state.entries);
    },
    unmount() {
      if (onStorageChanged) {
        chrome.storage.onChanged.removeListener(onStorageChanged);
        onStorageChanged = null;
      }
    },
    onActivate() {
      // No cross-panel context needed for panel-history
    },
  };
}
