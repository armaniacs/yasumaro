import { getMessage } from '../utils/i18n.js';
import type { SavedUrlEntry } from '../utils/storageUrls.js';
import type { HistoryPanelState, FilterType } from './historyState.js';

/**
 * Decide whether the SQLite History panel should fall back from a tag-based
 * filter to a full-text search when the tag filter produced no rows.
 *
 * Returns `null` when no fallback is desired (tag filter has hits, or the
 * request did not originate from a tag). Returns the trimmed search term
 * otherwise.
 *
 * Trigger conditions (all must hold):
 *  - `source` is 'tag' (i.e. navigation came from Tag Cluster, not manual search)
 *  - `tagRows` has zero total matches
 *  - `rawTagFilter` (without a leading '#') is non-empty after trimming
 */
export function shouldFallbackToTextSearch(
  source: 'tag' | 'manual',
  tagRows: { rows: unknown[]; total: number } | null,
  rawTagFilter: string | null,
): string | null {
  if (source !== 'tag') return null;
  if (rawTagFilter == null) return null;
  const trimmed = rawTagFilter.trim().replace(/^#/, '').trim();
  if (!trimmed) return null;
  if (tagRows && tagRows.total > 0) return null;
  return trimmed;
}

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
    // Tag matching: partial match (substring) to handle Tag Cluster filtering
    const matchesTag = !activeTagFilter || Boolean(entry.tags && entry.tags.some(tag => tag.includes(activeTagFilter)));
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

/**
 * Re-exported so the dashboard keeps a single import site while the reason
 * table itself lives next to the PendingPage type it describes.
 */
export { renderPendingReason } from '../utils/pendingStorage.js';

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
