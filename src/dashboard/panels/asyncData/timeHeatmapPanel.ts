/**
 * timeHeatmapPanel.ts (PanelLifecycle)
 * Renders weekday(7) x hour(24) browsing-record density as a heatmap table
 * plus a numeric text-alternative table (WCAG 2.1 AA: color is never the
 * only channel). The aggregation window is chosen with the shared period
 * filter (presets + custom range); the default preset is 'last90' — rich
 * enough for a density view while staying under the row cap for most
 * users, with 'all' one click away.
 */

import { queryLogs, getSqliteStatus, isServiceError } from '../../dashboardSqliteService.js';
import { MAX_TIME_HEATMAP_ROWS } from '../../../utils/computeLimits.js';
import { retryWithExponentialBackoff } from '../../utils/retry.js';
import { getMessage, getMessageOr } from '../../../utils/i18n.js';
import {
  createPeriodFilter,
  type PeriodFilterHandle,
  type PeriodRange,
} from '../../components/periodFilter.js';
import {
  aggregateTimeHeatmap,
  gridMax,
  intensityLevel,
  TIME_HEATMAP_HOURS,
  TIME_HEATMAP_WEEKDAYS,
  type TimeHeatmapGrid,
} from '../../timeHeatmapAggregate.js';
import type { BrowsingLogEntry } from '../../dashboardSqliteService.js';
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
  let currentRange: PeriodRange = {};
  let loadSeq = 0;
  let filterReady = false;

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
      // WHY: snapshot the range so retries reuse one consistent window even
      // if the user changes the filter mid-flight (stale loads bail via seq).
      const bounds = currentRange;
      const fetched = await loadRowsWithRetry(bounds);
      const rows = fetched.rows;
      if (seq !== loadSeq) return;

      if (rows.length === 0) {
        if (emptyState) emptyState.hidden = false;
        return;
      }

      // WHY: queryLogs caps the fetch, so only a total beyond the fetched
      // row count proves truncation — a period holding exactly the cap is
      // complete and must not claim a partial set.
      if (fetched.total > rows.length && limitNotice) {
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
          onChange: (range) => {
            currentRange = range;
            // WHY: auto-apply on selection — each load is a single capped
            // query (no paging), so the explicit Run-button pattern of the
            // domain-analysis panel is not warranted here.
            if (filterReady) void reload();
          },
        });
        filterHost.appendChild(filterHandle.element);
        currentRange = filterHandle.getRange();
        // WHY: the filter emits once during construction; arming the reload
        // trigger only after that initial emission prevents a duplicate load
        // when mount finishes.
        filterReady = true;
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

async function loadRowsWithRetry(bounds: PeriodRange): Promise<{ rows: BrowsingLogEntry[]; total: number }> {
  const result = await retryWithExponentialBackoff<{ rows: BrowsingLogEntry[]; total: number }>(
    async () => {
      const status = await getSqliteStatus();
      if (!status?.initialized) {
        return null;
      }
      // WHY: exactOptionalPropertyTypes forbids explicit undefined — unset
      // bounds pass no since/until key, so the all-time query stays a plain
      // { limit } call (tagClusterPanel convention).
      const qRes = await queryLogs({
        ...(bounds.since !== undefined ? { since: bounds.since } : {}),
        ...(bounds.until !== undefined ? { until: bounds.until } : {}),
        limit: MAX_TIME_HEATMAP_ROWS,
      });
      if (isServiceError(qRes)) {
        return null;
      }
      return qRes.data;
    },
    { label: 'timeHeatmap', maxAttempts: 4 },
  );
  // WHY: a failed query must not render as "no records" — throw so the
  // panel's catch shows a distinct error state (wordClusterPanel convention).
  if (result === null) {
    throw new Error('timeHeatmap: query failed after retries');
  }
  return result;
}
