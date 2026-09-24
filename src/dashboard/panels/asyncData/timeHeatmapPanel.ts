/**
 * timeHeatmapPanel.ts (PanelLifecycle)
 * Renders weekday(7) x hour(24) browsing-record density as a heatmap table
 * plus a numeric text-alternative table (WCAG 2.1 AA: color is never the
 * only channel). The aggregation window is chosen with the shared period
 * filter (presets + custom range); the default preset is 'last90' — rich
 * enough for a density view while staying under the row cap for most
 * users, with 'all' one click away.
 */

import { MAX_TIME_HEATMAP_ROWS } from '../../../utils/computeLimits.js';
import { fetchPeriodRows } from '../fetchPeriodRows.js';
import { getMessage, getMessageOr } from '../../../utils/i18n.js';
import {
  createPeriodFilter,
  type PeriodFilterHandle,
} from '../../components/periodFilter.js';
import {
  aggregateTimeHeatmap,
  gridMax,
  intensityLevel,
  TIME_HEATMAP_HOURS,
  TIME_HEATMAP_WEEKDAYS,
  type TimeHeatmapGrid,
  } from '../../timeHeatmapAggregate.js';
import { type PanelLifecycle } from '../types.js';

const WEEKDAY_KEYS = [
  'dashboardTimeHeatmapSun',
  'dashboardTimeHeatmapMon',
  'dashboardTimeHeatmapTue',
  'dashboardTimeHeatmapWed',
  'dashboardTimeHeatmapThu',
  'dashboardTimeHeatmapFri',
  'dashboardTimeHeatmapSat',
] as const;

const WEEKDAY_FALLBACK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function weekdayLabel(weekday: number): string {
  const key = WEEKDAY_KEYS[weekday];
  return (key !== undefined && getMessage(key)) || WEEKDAY_FALLBACK[weekday] || String(weekday);
}

function cellLabel(weekday: number, hour: number, count: number): string {
  const label = getMessage('dashboardTimeHeatmapCellLabel', {
    weekday: weekdayLabel(weekday),
    hour,
    count,
  });
  return label || `${weekdayLabel(weekday)} ${hour}:00 — ${count} records`;
}

export function createTimeHeatmapPanel(): PanelLifecycle {
  let gridEl: HTMLElement | null = null;
  let tableWrapEl: HTMLElement | null = null;
  let emptyState: HTMLElement | null = null;
  let limitNotice: HTMLElement | null = null;
  let filterHost: HTMLElement | null = null;
  let filterHandle: PeriodFilterHandle | null = null;
  let loadSeq = 0;

  /**
   * Swaps the empty-state element between its normal message and the load
   * failure message so a persistent query failure is not rendered as
   * "no records" (wordClusterPanel error-state convention).
   */
  function setEmptyStateMessage(key: string, fallback: string): void {
    if (!emptyState) return;
    emptyState.setAttribute('data-i18n', key);
    emptyState.textContent = getMessageOr(key, fallback);
  }

  async function reload(): Promise<void> {
    if (!gridEl || !tableWrapEl) return;
    const seq = ++loadSeq;

    gridEl.innerHTML = '';
    tableWrapEl.innerHTML = '';
    if (emptyState) emptyState.hidden = true;
    // WHY: restore the normal empty-state binding in case a previous load
    // failed and swapped in the error message.
    setEmptyStateMessage('dashboardTimeHeatmapEmpty', 'No browsing records in the selected period.');
    if (limitNotice) limitNotice.hidden = true;

    try {
      // WHY: getRange() is the single source of truth (PBI 2026-09-24-11);
      // the snapshot lets retries reuse one consistent window even if the
      // user changes the filter mid-flight (stale loads bail via seq). No
      // filter host → unbounded, like the pre-filter panel.
      const bounds = filterHandle ? filterHandle.getRange() : {};
      const fetched = await fetchPeriodRows({
        ...bounds,
        limit: MAX_TIME_HEATMAP_ROWS,
        label: 'timeHeatmap',
      });
      const rows = fetched.rows;
      if (seq !== loadSeq) return;

      if (rows.length === 0) {
        if (emptyState) emptyState.hidden = false;
        return;
      }

      if (fetched.capped && limitNotice) {
        limitNotice.hidden = false;
      }

      const grid = aggregateTimeHeatmap(rows.map((r) => r.created_at));
      const max = gridMax(grid);
      gridEl.appendChild(buildHeatmapTable(grid, max));
      tableWrapEl.appendChild(buildNumericTable(grid));
    } catch (error) {
      console.error('[timeHeatmapPanel] error:', error);
      if (seq !== loadSeq) return;
      setEmptyStateMessage(
        'dashboardTimeHeatmapError',
        'Failed to load the time heatmap. Try again.',
      );
      if (emptyState) emptyState.hidden = false;
    }
  }

  return {
    id: 'panel-time-heatmap',
    category: 'async-data',
    mount(container) {
      gridEl = container.querySelector('#timeHeatmapGrid');
      tableWrapEl = container.querySelector('#timeHeatmapTableWrap');
      emptyState = container.querySelector('#timeHeatmapEmptyState');
      limitNotice = container.querySelector('#timeHeatmapLimitNotice');
      filterHost = container.querySelector('#timeHeatmapFilter');
      if (filterHost) {
        filterHandle = createPeriodFilter({
          initialPreset: 'last90',
          onChange: () => {
            // WHY: auto-apply on selection — each load is a single capped
            // query (no paging), so the explicit Run-button pattern of the
            // domain-analysis panel is not warranted here. Construction
            // emits nothing (PBI 2026-09-24-11), so firing reload directly
            // is duplicate-safe.
            void reload();
          },
        });
        filterHost.appendChild(filterHandle.element);
      }
    },
    async load() {
      await reload();
    },
    destroy() {
      loadSeq += 1;
      filterHandle?.destroy();
      filterHandle = null;
      filterHost = null;
      gridEl = null;
      tableWrapEl = null;
      emptyState = null;
      limitNotice = null;
    },
  };
}

function buildHeatmapTable(grid: TimeHeatmapGrid, max: number): HTMLTableElement {
  const table = document.createElement('table');
  table.className = 'time-heatmap-grid';
  const caption = document.createElement('caption');
  caption.textContent = getMessage('dashboardTimeHeatmapTableCaption') || 'Browsing records by weekday and hour';
  table.appendChild(caption);

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.appendChild(document.createElement('th'));
  for (let h = 0; h < TIME_HEATMAP_HOURS; h++) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = `${h}:00`;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (let w = 0; w < TIME_HEATMAP_WEEKDAYS; w++) {
    const tr = document.createElement('tr');
    const rowHeader = document.createElement('th');
    rowHeader.scope = 'row';
    rowHeader.textContent = weekdayLabel(w);
    tr.appendChild(rowHeader);
    for (let h = 0; h < TIME_HEATMAP_HOURS; h++) {
      const count = grid[w]?.[h] ?? 0;
      const td = document.createElement('td');
      td.className = 'time-heatmap-cell';
      td.tabIndex = 0;
      td.dataset.intensity = String(intensityLevel(count, max));
      const label = cellLabel(w, h, count);
      td.title = label;
      td.setAttribute('aria-label', label);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

function buildNumericTable(grid: TimeHeatmapGrid): HTMLTableElement {
  const table = document.createElement('table');
  table.className = 'time-heatmap-numeric';
  const caption = document.createElement('caption');
  caption.textContent = getMessage('dashboardTimeHeatmapNumericCaption') || 'Browsing record counts by weekday and hour';
  table.appendChild(caption);

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.appendChild(document.createElement('th'));
  for (let h = 0; h < TIME_HEATMAP_HOURS; h++) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = `${h}:00`;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (let w = 0; w < TIME_HEATMAP_WEEKDAYS; w++) {
    const tr = document.createElement('tr');
    const rowHeader = document.createElement('th');
    rowHeader.scope = 'row';
    rowHeader.textContent = weekdayLabel(w);
    tr.appendChild(rowHeader);
    for (let h = 0; h < TIME_HEATMAP_HOURS; h++) {
      const td = document.createElement('td');
      td.textContent = String(grid[w]?.[h] ?? 0);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}
