import { tOrKey as t } from '../../../utils/i18n.js';
import {
  endOfLocalDayMs,
  parseLocalDateStart,
} from '../../../utils/localDate.js';
import { escapeHtml } from '../../../utils/htmlEscape.js';
import { setElementHtml } from '../../../utils/htmlFragment.js';
import { formatDate, SQLITE_HISTORY_IDS } from './sqliteHistoryPanelView.js';
import type { SqliteHistoryState } from './sqliteHistoryPanelState.js';
import type { SqliteHistoryViewCallbacks } from './sqliteHistoryPanelView.js';

// ---------------------------------------------------------------------------
// Chrome wiring (PBI 2026-11-07-13) — calendar/sort build + wire, moved
// verbatim from sqliteHistoryPanelView.ts. The View re-exports every name
// below so existing importers keep working; new code should import from this
// module directly. `formatDate` and `SQLITE_HISTORY_IDS` stay owned by the
// View and are imported from it (deferred use only, no top-level reads).
// ---------------------------------------------------------------------------

function queryById<T extends Element>(root: ParentNode, id: string): T | null {
  return root.querySelector(`#${id}`) as T | null;
}

export function sortSelectValue(sortBy: SqliteHistoryState['sortBy'], sortDir: SqliteHistoryState['sortDir']): string {
  return `${sortBy}:${sortDir}`;
}

export function parseSortSelectValue(value: string): { sortBy: SqliteHistoryState['sortBy']; sortDir: SqliteHistoryState['sortDir'] } {
  const [sortBy, sortDir] = value.split(':');
  return {
    sortBy: sortBy === 'relevance' ? 'relevance' : 'created_at',
    sortDir: sortDir === 'ASC' ? 'ASC' : 'DESC',
  };
}

/** Builds the HTML markup for the sort control select. */
export function buildSortControlHtml(
  sortBy: SqliteHistoryState['sortBy'],
  sortDir: SqliteHistoryState['sortDir'],
  hasActiveSearch: boolean,
): string {
  const options = [
    { value: sortSelectValue('created_at', 'DESC'), label: t('historySortNewest') || '新しい順' },
    { value: sortSelectValue('created_at', 'ASC'), label: t('historySortOldest') || '古い順' },
  ];
  if (hasActiveSearch) {
    options.push({ value: sortSelectValue('relevance', 'DESC'), label: t('historySortRelevance') || '関連度順' });
  }

  const currentValue = sortSelectValue(sortBy, sortDir);
  // A relevance value with no active search cannot be rendered (its option
  // was omitted above); fall back to newest-first so the select always has
  // a matching selected option.
  const safeValue = options.some(o => o.value === currentValue) ? currentValue : sortSelectValue('created_at', 'DESC');

  return `
    <label class="sqlite-sort-label" for="sqlite-sort-select">${t('historySortLabel') || '並び替え'}</label>
    <select id="${SQLITE_HISTORY_IDS.sortSelect}" aria-label="${t('historySortLabel') || '並び替え'}">
      ${options.map(o => `<option value="${o.value}"${o.value === safeValue ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
    </select>
  `;
}

export interface CalendarNavHtml {
  html: string;
  year: number;
  month: number;
}

/** Builds the HTML markup for the calendar navigation shell (quick buttons + month header), excluding the day grid. */
export function buildCalendarNavHtml(
  selectedDate: string | null,
  options: { searchQuery: string; activeTagFilter: string | null },
): CalendarNavHtml {
  const now = new Date();
  const currentMonth = selectedDate
    ? new Date(parseLocalDateStart(selectedDate))
    : now;

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const hasActiveFilters = Boolean(options.searchQuery.trim()) || selectedDate != null || options.activeTagFilter != null;

  const html = `
    <div class="sqlite-calendar-quick">
      <button data-date="${formatDate(now)}">${t('historyToday')}</button>
      <button data-date="${formatDate(new Date(now.getTime() - 86400000))}">${t('historyYesterday')}</button>
      <button data-date="${formatDate(now)}" data-range="7">${t('historyLast7Days')}</button>
      <button data-date="${formatDate(now)}" data-range="30">${t('historyLast30Days')}</button>
      ${hasActiveFilters ? `<button type="button" id="${SQLITE_HISTORY_IDS.clearAllFilters}" class="sqlite-clear-filters-btn" aria-label="${t('clearAllFilters') || 'Clear all filters'}">${t('clearAllFilters') || '条件をクリア'}</button>` : ''}
      <button type="button" id="${SQLITE_HISTORY_IDS.sendToCollection}" class="sqlite-send-to-collection-btn">${t('historySendToCollection')}</button>
    </div>
    <div id="${SQLITE_HISTORY_IDS.handoffReason}" class="sqlite-handoff-reason" role="status"></div>
    <div class="sqlite-calendar-month">
      <button data-month-prev>&lt;</button>
      <span>${year}-${String(month + 1).padStart(2, '0')}</span>
      <button data-month-next>&gt;</button>
    </div>
    <div class="sqlite-calendar-days" id="${SQLITE_HISTORY_IDS.calendarDays}"></div>
  `;

  return { html, year, month };
}

/** Builds the HTML markup for the calendar day grid for the given year/month. */
export function buildCalendarDaysHtml(year: number, month: number, selectedDate: string | null): string {
  const now = new Date();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();

  let daysHtml = '';
  for (let i = 0; i < firstDay; i++) {
    daysHtml += '<span class="day empty" aria-hidden="true"></span>';
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isSelected = dateStr === selectedDate;
    const isToday = dateStr === formatDate(now);
    const dateLabel = `${year}${t('historyDateYear')}${month + 1}${t('historyDateMonth')}${d}${t('historyDateDay')}`;
    daysHtml += `<button type="button" class="day${isSelected ? ' selected' : ''}${isToday ? ' today' : ''}"
      data-date="${dateStr}" aria-pressed="${isSelected}" aria-label="${dateLabel}">${d}</button>`;
  }
  return daysHtml;
}

/** Builds sort-control HTML and wires the select. No-op when the region is absent. */
export function wireSortControl(
  container: HTMLElement,
  sortBy: SqliteHistoryState['sortBy'],
  sortDir: SqliteHistoryState['sortDir'],
  hasActiveSearch: boolean,
  callbacks: Pick<SqliteHistoryViewCallbacks, 'onSortChange'>,
): void {
  const region = queryById<HTMLElement>(container, SQLITE_HISTORY_IDS.sortControl);
  if (!region) return;
  setElementHtml(region, buildSortControlHtml(sortBy, sortDir, hasActiveSearch));

  const select = queryById<HTMLSelectElement>(region, SQLITE_HISTORY_IDS.sortSelect);
  select?.addEventListener('change', () => {
    const parsed = parseSortSelectValue(select.value);
    callbacks.onSortChange(parsed.sortBy, parsed.sortDir);
  });
}

/** Builds calendar-nav HTML and wires date/month/clear/send actions. No-op when absent. */
export function wireCalendarNav(
  container: HTMLElement,
  selectedDate: string | null,
  options: { searchQuery: string; activeTagFilter: string | null },
  callbacks: Pick<SqliteHistoryViewCallbacks, 'onDateSelect' | 'onRangeSelect' | 'onClearFilters'> & Pick<SqliteHistoryViewCallbacks, 'onSendToCollection'>,
): void {
  const region = queryById<HTMLElement>(container, SQLITE_HISTORY_IDS.calendarNav);
  if (!region) return;
  const { html, year, month } = buildCalendarNavHtml(selectedDate, options);
  setElementHtml(region, html);

  region.querySelectorAll('[data-date]').forEach(el => {
    el.addEventListener('click', () => {
      const date = (el as HTMLElement).dataset.date;
      if (!date) return;
      const range = (el as HTMLElement).dataset.range;
      if (range) {
        const rangeDays = Number(range);
        if (!Number.isInteger(rangeDays)) return;
        const dayStart = parseLocalDateStart(date);
        // WHY the end is a local end-of-day: the quick buttons mean "the last
        // N days up to and including the clicked day", and on a DST
        // transition that day is not 86_400_000 ms long.
        const since = dayStart - (rangeDays * 86_400_000);
        callbacks.onRangeSelect(since, endOfLocalDayMs(dayStart));
      } else {
        callbacks.onDateSelect(date);
      }
    });
  });

  region.querySelector('[data-month-prev]')?.addEventListener('click', () => {
    const d = new Date(year, month - 1, 1);
    callbacks.onDateSelect(formatDate(d));
  });
  region.querySelector('[data-month-next]')?.addEventListener('click', () => {
    const d = new Date(year, month + 1, 1);
    callbacks.onDateSelect(formatDate(d));
  });

  region.querySelector(`#${SQLITE_HISTORY_IDS.clearAllFilters}`)?.addEventListener('click', () => {
    const searchInput = queryById<HTMLInputElement>(container, SQLITE_HISTORY_IDS.searchInput);
    if (searchInput) searchInput.value = '';
    callbacks.onClearFilters();
  });

  // History → collection handoff (PBI 2026-11-02-03): the panel packs the
  // triple, so the view only forwards the click and paints the reason line.
  region.querySelector(`#${SQLITE_HISTORY_IDS.sendToCollection}`)?.addEventListener('click', () => {
    callbacks.onSendToCollection?.();
  });

  const daysEl = queryById<HTMLElement>(region, SQLITE_HISTORY_IDS.calendarDays);
  if (!daysEl) return;

  setElementHtml(daysEl, buildCalendarDaysHtml(year, month, selectedDate));

  daysEl.querySelectorAll('.day:not(.empty)').forEach(el => {
    el.addEventListener('click', () => {
      const date = (el as HTMLElement).dataset.date;
      if (!date) return;
      callbacks.onDateSelect(date);
    });
  });
}
