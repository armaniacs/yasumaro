import { getMessage } from '../popup/i18n.js';
import type { SavedUrlEntry } from '../utils/storageUrls.js';
import type { HistoryPanelState, FilterType } from './historyState.js';

export function getFilteredEntries(
  entries: SavedUrlEntry[],
  activeFilter: FilterType,
  activeTagFilter: string | null,
  searchText: string,
): SavedUrlEntry[] {
  return entries.filter(function matchesAllFilters(entry): boolean {
    // Search across URL, AI summary, tags, and content
    const matchesSearch = !searchText || 
      entry.url.toLowerCase().includes(searchText) ||
      (entry.aiSummary || '').toLowerCase().includes(searchText) ||
      (entry.tags || []).some(tag => tag.toLowerCase().includes(searchText)) ||
      (entry.content || '').toLowerCase().includes(searchText);
    const matchesFilter = matchesFilterType(entry, activeFilter);
    const matchesTag = !activeTagFilter || Boolean(entry.tags && entry.tags.includes(activeTagFilter));
    return matchesSearch && matchesFilter && matchesTag;
  });
}

function matchesFilterType(entry: SavedUrlEntry, activeFilter: FilterType): boolean {
  if (activeFilter === 'all') {
    return true;
  }

  if (activeFilter === 'auto') {
    return !entry.recordType || entry.recordType === 'auto';
  }

  if (activeFilter === 'manual') {
    return entry.recordType === 'manual';
  }

  if (activeFilter === 'masked') {
    return Boolean(entry.maskedCount && entry.maskedCount > 0);
  }

  if (activeFilter === 'cleansed') {
    return Boolean(entry.cleansedReason && entry.cleansedReason !== 'none');
  }

  return true;
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
