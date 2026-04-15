import { getMessage } from '../popup/i18n.js';
import type { SavedUrlEntry } from '../utils/storageUrls.js';
import type { HistoryPanelState, FilterType } from './historyState.js';

export function getFilteredEntries(
  entries: SavedUrlEntry[],
  activeFilter: FilterType,
  activeTagFilter: string | null,
  searchText: string,
): SavedUrlEntry[] {
  return entries.filter(e => {
    const matchesSearch = !searchText || e.url.toLowerCase().includes(searchText);
    const matchesType =
      activeFilter === 'all' ||
      (activeFilter === 'auto' && (!e.recordType || e.recordType === 'auto')) ||
      (activeFilter === 'manual' && e.recordType === 'manual') ||
      (activeFilter === 'masked' && !!e.maskedCount && e.maskedCount > 0) ||
      (activeFilter === 'cleansed' && !!e.cleansedReason && e.cleansedReason !== 'none');
    const matchesTag = !activeTagFilter || (e.tags && e.tags.includes(activeTagFilter));
    return matchesSearch && matchesType && matchesTag;
  });
}

export function renderPendingReason(reason: string): string {
  switch (reason) {
    case 'cache-control': return getMessage('pendingReasonCache') || 'Cache-Control ヘッダー';
    case 'set-cookie':    return getMessage('pendingReasonCookie') || 'Set-Cookie ヘッダー';
    case 'authorization': return getMessage('pendingReasonAuth') || 'Authorization ヘッダー';
    default:              return reason;
  }
}

export function updateTagFilterIndicator(state: HistoryPanelState, onClear: () => void): void {
  const existingIndicator = document.getElementById('tagFilterIndicator');
  if (existingIndicator) {
    existingIndicator.remove();
  }

  if (!state.activeTagFilter) return;

  const controls = document.querySelector('.history-controls');
  if (!controls) return;

  const indicator = document.createElement('div');
  indicator.id = 'tagFilterIndicator';
  indicator.className = 'tag-filter-indicator';

  const filterLabel = document.createElement('span');
  filterLabel.className = 'tag-filter-label';
  filterLabel.textContent = 'フィルター:';

  const filterValue = document.createElement('span');
  filterValue.className = 'tag-filter-value';
  filterValue.textContent = `#${state.activeTagFilter}`;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'tag-filter-close';
  closeBtn.title = 'フィルター解除';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', onClear);

  indicator.append(filterLabel, filterValue, closeBtn);
  controls.appendChild(indicator);
}
