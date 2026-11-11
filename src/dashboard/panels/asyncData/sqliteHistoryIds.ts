/**
 * sqliteHistoryIds.ts
 * SSOT for every DOM id the SQLite history view creates (PBI 2026-11-11-02).
 *
 * Moved verbatim from `sqliteHistoryPanelView.ts` so the calendar/sort
 * wiring (`sqliteHistoryChromeWiring.ts`) and the confirm dialogs
 * (`sqliteHistoryConfirmDialogs.ts`) no longer value-import the View.
 * The View re-exports this object so existing importers keep working.
 */
export const SQLITE_HISTORY_IDS = {
  searchInput: 'sqlite-search-input',
  sortControl: 'sqlite-sort-control',
  sortSelect: 'sqlite-sort-select',
  calendarNav: 'sqlite-calendar-nav',
  calendarDays: 'sqlite-calendar-days',
  clearAllFilters: 'sqlite-clear-all-filters',
  pendingRegion: 'sqlite-pending-region',
  entryList: 'sqlite-entry-list',
  pagination: 'sqlite-pagination',
  error: 'sqlite-error',
  bulkBar: 'sqlite-bulk-bar',
  selectAll: 'sqlite-select-all',
  clearSelection: 'sqlite-clear-selection',
  selectionCount: 'sqlite-selection-count',
  appendObsidian: 'sqlite-append-obsidian',
  regenerateSelected: 'sqlite-regenerate-selected',
  deleteSelected: 'sqlite-delete-selected',
  // Bulk star (PBI 2026-10-23-07): two-step confirm with a private-judged
  // exclusion branch, then an inline undo for the applied batch.
  starSelected: 'sqlite-star-selected',
  starConfirm: 'sqlite-star-confirm',
  starConfirmAll: 'sqlite-star-confirm-all',
  starConfirmExclude: 'sqlite-star-confirm-exclude',
  starConfirmCancel: 'sqlite-star-confirm-cancel',
  starUndo: 'sqlite-star-undo',
  starUndoBtn: 'sqlite-star-undo-btn',
  deleteConfirm: 'sqlite-delete-confirm',
  deleteConfirmYes: 'sqlite-delete-confirm-yes',
  deleteConfirmNo: 'sqlite-delete-confirm-no',
  tagFilterBar: 'sqlite-tag-filter-bar',
  tagFilterClear: 'sqlite-tag-filter-clear',
  sendToCollection: 'sqlite-send-to-collection',
  handoffReason: 'sqlite-handoff-reason',
} as const;
