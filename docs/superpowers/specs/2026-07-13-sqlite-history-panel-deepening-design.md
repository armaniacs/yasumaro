# Design: sqliteHistoryPanel.ts Deepening — Function Signature Parameterization

**Date:** 2026-07-13
**Status:** Implemented (2026-07-17)
**PBI:** [2026-07-13-03-fix-sqlite-history-panel-deepening](../pbi/2026-07-13-03-fix-sqlite-history-panel-deepening.md)

---

## Deep Dig Revision

Initial design proposed extracting 4 modules. Deep dig revealed:
1. File splitting alone does not enable testability — functions still depend on global DOM and state
2. The root problem is **function signatures hardcoded to `document.getElementById()` and module-level `state`**
3. Fixing signatures avoids unnecessary module boundary overhead
4. DOM event wiring knowledge belongs in the module that generates the HTML — that module receives a container and wires its own subtree

**Revised approach**: Parameterize function signatures only. No file moves. Estimate reduced from 3pt → 1pt.

---

## Architecture Overview

### Current State

Every function in `sqliteHistoryPanel.ts` accesses global `state` and global DOM via `document.getElementById()`:

```ts
function renderCalendarNav(): void {
  const navEl = document.getElementById('sqlite-calendar-nav');  // global DOM
  const currentMonth = state.selectedDate                        // global state
    ? new Date(state.selectedDate + 'T00:00:00') : new Date();
  // ... 120 lines of calendar HTML + event wiring
}
```

This makes functions untestable — you can't call them with test data.

### Target State

Functions receive data and DOM containers as parameters. Callbacks replace direct state mutation:

```ts
function renderCalendarNav(
  container: HTMLElement,
  selectedDate: string | null,
  options: { searchQuery: string; activeTagFilter: string | null },
  callbacks: {
    onDateSelect: (d: string) => void;
    onRangeSelect: (since: number, until: number) => void;
    onClearFilters: () => void;
  }
): void {
  // Same logic, zero global dependencies
}
```

---

## Functions to Parameterize

| Function | Current deps | New signature |
|----------|-------------|---------------|
| `renderCalendarNav()` | `document.getElementById`, `state.selectedDate`, `state.searchQuery`, `state.activeTagFilter` | `(container, selectedDate, options, callbacks)` |
| `renderEntryList()` | `document.getElementById`, `state.entries`, `state.selectedIds`, `state.activeTagFilter` | `(container, entries, selectedIds, activeTagFilter, callbacks)` |
| `renderPagination()` | `document.getElementById`, `state.currentPage`, `state.total` | `(container, currentPage, total, PAGE_SIZE, callback)` |
| `updateBulkBar()` | `document.getElementById`, `state.selectedIds`, `state.entries` | `(selectedIds, entries, callbacks)` |
| `updateTagFilterBar()` | `document.querySelector`, `state.activeTagFilter` | `(container, activeTagFilter, callback)` |
| `renderState()` | All of the above | Remains orchestrator — calls parameterized functions |
| `loadData()` | `state`, `refresh()` | Add `state` as parameter or make it return data to caller |

### Functions that need no changes (already testable)

| Function | Reason |
|----------|--------|
| `formatDiagnosticMetadataHtml()` | Pure function — input `BrowsingLogEntry`, output HTML string |
| `buildCleansingProgressBarHtml()` | Pure function |
| `enrichEntryWithChromeStorage()` | Pure function — input entry + storageMap, output enriched entry |
| `escapeHtml()` | Pure utility |
| `formatTimestamp()` | Pure utility |
| `debounce()` | Pure utility |

---

## Panel Responsibility After Changes

The panel (`sqliteHistoryPanel.ts`) becomes:

1. **State owner** — `SqliteHistoryState` object, the single source of truth
2. **Data loader** — `loadData()` fetches from SQLite, updates state, calls `refresh()`
3. **Refresh orchestrator** — `refresh()` passes current state to each render function

```ts
function refresh(): void {
  if (state.loading) {
    renderEntryList(listContainer, [], new Set(), null, callbacks);
    return;
  }

  renderCalendarNav(calContainer, state.selectedDate,
    { searchQuery: state.searchQuery, activeTagFilter: state.activeTagFilter },
    calendarCallbacks);

  renderEntryList(listContainer, state.entries, state.selectedIds,
    state.activeTagFilter, entryCallbacks);

  renderPagination(pagContainer, state.currentPage, state.total,
    PAGE_SIZE, onPageChange);

  updateBulkBar(state.selectedIds, state.entries, bulkCallbacks);
  updateTagFilterBar(tagContainer, state.activeTagFilter, onTagClear);
}
```

Search input is the only DOM element owned permanently by the panel (to preserve caret position across re-renders).

---

## Testing

Before: impossible to unit test any rendering function.
After: each function is independently testable:

```ts
// CalendarWidget test
test('renders selected date', () => {
  const container = document.createElement('div');
  renderCalendarNav(container, '2026-07-13', {}, {});
  expect(container.querySelector('.day.selected')).not.toBeNull();
});

// DiagnosticFormatter test (already testable, no changes needed)
test('builds progress bar with correct ratio', () => {
  const html = buildCleansingProgressBarHtml({ page_bytes: 10000, ai_summary_cleansed_bytes: 2000 });
  expect(html).toContain('width:20.0%');
});
```

---

## Dependencies

- **Blocks**: Nothing
- **Blocked by**: None (independent of SQLite backend changes)
- **Parallel with**: PBI #4 (error propagation)
