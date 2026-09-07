// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  buildCleansingProgressBarHtml,
  sortSelectValue,
  parseSortSelectValue,
  isFullTextSearchActive,
  buildPaginationHtml,
  buildSortControlHtml,
  buildCalendarNavHtml,
  buildCalendarDaysHtml,
  SQLITE_HISTORY_IDS,
  isViewMounted,
  render,
} from '../sqliteHistoryPanelView.js';
import type { SqliteHistoryViewCallbacks } from '../sqliteHistoryPanelView.js';
import type { BrowsingLogEntry } from '../../../../utils/sqlite-types.js';
import { createInitialHistoryState } from '../sqliteHistoryPanelState.js';
import type { SqliteHistoryState } from '../sqliteHistoryPanelState.js';

const baseEntry: BrowsingLogEntry = {
  id: 1,
  url: 'https://example.com',
  title: 'Example',
  created_at: 1700000000000,
};

function makeState(overrides: Partial<SqliteHistoryState> = {}): SqliteHistoryState {
  return { ...createInitialHistoryState(), ...overrides };
}

describe('buildCleansingProgressBarHtml', () => {
  it('returns empty string when page_bytes is missing', () => {
    expect(buildCleansingProgressBarHtml({ ...baseEntry })).toBe('');
  });

  it('returns empty string when page_bytes is zero', () => {
    expect(buildCleansingProgressBarHtml({ ...baseEntry, page_bytes: 0, cleansed_bytes: 10 })).toBe('');
  });

  it('renders a progress bar with reduction label when bytes are present', () => {
    const html = buildCleansingProgressBarHtml({
      ...baseEntry,
      page_bytes: 1000,
      original_bytes: 1000,
      cleansed_bytes: 500,
    });
    expect(html).toContain('cleansing-progress-bar');
    expect(html).toContain('data-bar-width="50.0"');
    expect(html).toContain('1000 B');
    expect(html).toContain('500 B');
  });

  it('formats large byte counts in KB/MB', () => {
    const html = buildCleansingProgressBarHtml({
      ...baseEntry,
      page_bytes: 2 * 1024 * 1024,
      original_bytes: 2 * 1024 * 1024,
      cleansed_bytes: 1024,
    });
    expect(html).toContain('2.0 MB');
    expect(html).toContain('1.0 KB');
  });

  it('prefers cleansed_bytes/original_bytes when fallback_triggered is set', () => {
    const html = buildCleansingProgressBarHtml({
      ...baseEntry,
      page_bytes: 1000,
      fallback_triggered: 1,
      cleansed_bytes: 300,
      ai_summary_cleansed_bytes: 999,
    });
    expect(html).toContain('300 B');
    expect(html).not.toContain('999 B');
  });
});

describe('sortSelectValue / parseSortSelectValue round-trip', () => {
  it('round-trips created_at DESC', () => {
    const value = sortSelectValue('created_at', 'DESC');
    expect(value).toBe('created_at:DESC');
    expect(parseSortSelectValue(value)).toEqual({ sortBy: 'created_at', sortDir: 'DESC' });
  });

  it('round-trips created_at ASC', () => {
    const value = sortSelectValue('created_at', 'ASC');
    expect(parseSortSelectValue(value)).toEqual({ sortBy: 'created_at', sortDir: 'ASC' });
  });

  it('round-trips relevance DESC', () => {
    const value = sortSelectValue('relevance', 'DESC');
    expect(parseSortSelectValue(value)).toEqual({ sortBy: 'relevance', sortDir: 'DESC' });
  });

  it('falls back to created_at/DESC for unrecognized values', () => {
    expect(parseSortSelectValue('garbage:VALUE')).toEqual({ sortBy: 'created_at', sortDir: 'DESC' });
  });
});

describe('isFullTextSearchActive', () => {
  it('is false when searchQuery is empty', () => {
    expect(isFullTextSearchActive(makeState({ searchQuery: '' }))).toBe(false);
  });

  it('is false when searchQuery is whitespace only', () => {
    expect(isFullTextSearchActive(makeState({ searchQuery: '   ' }))).toBe(false);
  });

  it('is true when searchQuery is set and no active tag filter', () => {
    expect(isFullTextSearchActive(makeState({ searchQuery: 'foo', activeTagFilter: null }))).toBe(true);
  });

  it('is false when searchQuery is set with an active tag filter and no fallback', () => {
    expect(isFullTextSearchActive(makeState({
      searchQuery: 'foo',
      activeTagFilter: 'work',
      pendingTagFallback: null,
    }))).toBe(false);
  });

  it('is true when a tag fallback search is pending, even with an active tag filter', () => {
    expect(isFullTextSearchActive(makeState({
      searchQuery: 'foo',
      activeTagFilter: 'work',
      pendingTagFallback: { tag: 'work', fallbackTo: 'foo', matched: 0 },
    }))).toBe(true);
  });
});

describe('buildPaginationHtml', () => {
  it('returns empty string for zero total', () => {
    expect(buildPaginationHtml(0, 0, 20)).toBe('');
  });

  it('returns empty string for a single page', () => {
    expect(buildPaginationHtml(0, 15, 20)).toBe('');
  });

  it('renders prev/next controls for multiple pages', () => {
    const html = buildPaginationHtml(1, 100, 20);
    expect(html).toContain('data-page="prev"');
    expect(html).toContain('data-page="next"');
    expect(html).not.toContain('disabled');
  });

  it('disables prev on the first page', () => {
    const html = buildPaginationHtml(0, 100, 20);
    expect(html).toMatch(/disabled[^>]*>[\s\S]*?data-page="prev"|data-page="prev">/);
    const prevMatch = html.match(/<button ([^>]*)data-page="prev"/);
    expect(prevMatch?.[1]).toContain('disabled');
  });

  it('disables next on the last page', () => {
    const html = buildPaginationHtml(4, 100, 20);
    const nextMatch = html.match(/<button ([^>]*)data-page="next"/);
    expect(nextMatch?.[1]).toContain('disabled');
  });
});

describe('buildSortControlHtml', () => {
  it('does not include the relevance option when no active search', () => {
    const html = buildSortControlHtml('created_at', 'DESC', false);
    expect(html).not.toContain('relevance:DESC');
  });

  it('includes the relevance option when a search is active', () => {
    const html = buildSortControlHtml('created_at', 'DESC', true);
    expect(html).toContain('relevance:DESC');
  });

  it('marks the matching option as selected', () => {
    const html = buildSortControlHtml('created_at', 'ASC', false);
    expect(html).toMatch(/value="created_at:ASC" selected/);
  });

  it('falls back to newest-first selection when relevance is selected but search inactive', () => {
    const html = buildSortControlHtml('relevance', 'DESC', false);
    expect(html).toMatch(/value="created_at:DESC" selected/);
  });
});

describe('buildCalendarNavHtml', () => {
  it('uses the current month when no date is selected', () => {
    const { year, month } = buildCalendarNavHtml(null, { searchQuery: '', activeTagFilter: null });
    const now = new Date();
    expect(year).toBe(now.getFullYear());
    expect(month).toBe(now.getMonth());
  });

  it('uses the selected date month when provided', () => {
    const { html, year, month } = buildCalendarNavHtml('2026-03-15', { searchQuery: '', activeTagFilter: null });
    expect(year).toBe(2026);
    expect(month).toBe(2); // 0-indexed March
    expect(html).toContain('2026-03');
  });

  it('omits the clear-filters button when no filters are active', () => {
    const { html } = buildCalendarNavHtml(null, { searchQuery: '', activeTagFilter: null });
    expect(html).not.toContain(SQLITE_HISTORY_IDS.clearAllFilters);
  });

  it('includes the clear-filters button when a date is selected', () => {
    const { html } = buildCalendarNavHtml('2026-03-15', { searchQuery: '', activeTagFilter: null });
    expect(html).toContain(SQLITE_HISTORY_IDS.clearAllFilters);
  });

  it('includes the clear-filters button when a search query is active', () => {
    const { html } = buildCalendarNavHtml(null, { searchQuery: 'foo', activeTagFilter: null });
    expect(html).toContain(SQLITE_HISTORY_IDS.clearAllFilters);
  });

  it('includes the clear-filters button when a tag filter is active', () => {
    const { html } = buildCalendarNavHtml(null, { searchQuery: '', activeTagFilter: 'work' });
    expect(html).toContain(SQLITE_HISTORY_IDS.clearAllFilters);
  });
});

describe('buildCalendarDaysHtml', () => {
  it('renders the correct number of day buttons for the month', () => {
    // 2026-02 is not a leap year context check: Feb 2026 has 28 days
    const html = buildCalendarDaysHtml(2026, 1, null);
    const dayButtons = html.match(/<button/g) ?? [];
    expect(dayButtons.length).toBe(28);
  });

  it('renders leading empty cells for the first day offset', () => {
    // 2026-03-01 is a Sunday (getDay() === 0), so no leading empty cells
    const html = buildCalendarDaysHtml(2026, 2, null);
    const firstDayOfMonth = new Date(2026, 2, 1).getDay();
    const emptyCells = html.match(/class="day empty"/g) ?? [];
    expect(emptyCells.length).toBe(firstDayOfMonth);
  });

  it('marks the selected date', () => {
    const html = buildCalendarDaysHtml(2026, 2, '2026-03-10');
    expect(html).toMatch(/class="day selected[^"]*"\s*\n?\s*data-date="2026-03-10"/);
  });

  it('marks today when it falls within the rendered month', () => {
    const now = new Date();
    const html = buildCalendarDaysHtml(now.getFullYear(), now.getMonth(), null);
    expect(html).toContain('today');
  });
});

describe('render — single entry with diff/full decided inside', () => {
  function noopCallbacks(overrides: Partial<SqliteHistoryViewCallbacks> = {}): SqliteHistoryViewCallbacks {
    return {
      onDateSelect: () => undefined,
      onRangeSelect: () => undefined,
      onClearFilters: () => undefined,
      onSearchInput: () => undefined,
      onSortChange: () => undefined,
      onPageChange: () => undefined,
      onToggleStar: () => undefined,
      onDelete: () => undefined,
      onSelectionChange: () => undefined,
      onTagFilterClick: () => undefined,
      onContentToggle: () => undefined,
      onSelectAll: () => undefined,
      onClearSelection: () => undefined,
      onAppend: () => undefined,
      onTagFilterClear: () => undefined,
      translateError: (error) => error ?? '',
      createCopyButton: () => document.createElement('button'),
      ...overrides,
    };
  }

  function stateWithEntries(): SqliteHistoryState {
    return makeState({
      entries: [
        { ...baseEntry, id: 1, title: 'First', created_at: 1700000000000 },
        { ...baseEntry, id: 2, title: 'Second', created_at: 1700000001000 },
      ],
      total: 2,
    });
  }

  it('builds the shell on first call (not mounted → full)', () => {
    const container = document.createElement('div');
    expect(isViewMounted(container)).toBe(false);
    render(container, stateWithEntries(), noopCallbacks());
    expect(isViewMounted(container)).toBe(true);
    for (const id of [
      SQLITE_HISTORY_IDS.searchInput,
      SQLITE_HISTORY_IDS.sortControl,
      SQLITE_HISTORY_IDS.calendarNav,
      SQLITE_HISTORY_IDS.entryList,
      SQLITE_HISTORY_IDS.pagination,
    ]) {
      expect(container.querySelector(`#${id}`), id).not.toBeNull();
    }
    expect(container.querySelectorAll('.sqlite-entry').length).toBe(2);
  });

  it('diff and full paths converge to the same end state', () => {
    const target = stateWithEntries();
    const callbacks = noopCallbacks();

    const viaFull = document.createElement('div');
    render(viaFull, target, callbacks);

    const viaDiff = document.createElement('div');
    render(viaDiff, makeState(), callbacks); // full with empty state
    render(viaDiff, target, callbacks); // diff onto the mounted shell

    expect(viaDiff.querySelector(`#${SQLITE_HISTORY_IDS.entryList}`)?.innerHTML)
      .toBe(viaFull.querySelector(`#${SQLITE_HISTORY_IDS.entryList}`)?.innerHTML);
    expect(viaDiff.querySelector(`#${SQLITE_HISTORY_IDS.pagination}`)?.innerHTML)
      .toBe(viaFull.querySelector(`#${SQLITE_HISTORY_IDS.pagination}`)?.innerHTML);
    expect(viaDiff.querySelectorAll('.sqlite-entry').length).toBe(2);
  });

  it('preserves search-input focus across a diff refresh (no focus steal)', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    try {
      const callbacks = noopCallbacks();
      render(container, stateWithEntries(), callbacks);
      const input = container.querySelector(`#${SQLITE_HISTORY_IDS.searchInput}`) as HTMLInputElement;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      render(container, stateWithEntries(), callbacks); // diff path
      expect(document.activeElement).toBe(input);
    } finally {
      container.remove();
    }
  });

  it('wires entry actions to the callback bundle exactly once per render', () => {
    const container = document.createElement('div');
    let toggled: number[] = [];
    const callbacks = noopCallbacks({ onToggleStar: (id) => { toggled.push(id); } });
    // Full path then diff path: diff rewires its region, so one click fires once.
    render(container, stateWithEntries(), callbacks);
    render(container, stateWithEntries(), callbacks);
    const star = container.querySelector('.sqlite-entry[data-id="1"] [data-action="star"]') as HTMLButtonElement;
    star.click();
    expect(toggled).toEqual([1]);
  });

  it('keeps data-i18n and aria attributes invariant', () => {
    const container = document.createElement('div');
    render(container, stateWithEntries(), noopCallbacks());
    expect(container.querySelector('[data-i18n="sqliteHistoryTitle"]')).not.toBeNull();
    expect(container.querySelector('[data-i18n="historySelectAll"]')).not.toBeNull();
    const searchInput = container.querySelector(`#${SQLITE_HISTORY_IDS.searchInput}`);
    expect(searchInput?.getAttribute('aria-label')).toBeTruthy();
    const select = container.querySelector(`#${SQLITE_HISTORY_IDS.sortSelect}`);
    expect(select?.getAttribute('aria-label')).toBeTruthy();
    const pressed = container.querySelector('.sqlite-entry-star')?.getAttribute('aria-pressed');
    expect(['true', 'false']).toContain(pressed);
  });
});
