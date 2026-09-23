/**
 * timeHeatmapPanel.ts (PanelLifecycle)
 * Renders weekday(7) x hour(24) browsing-record density as a heatmap table
 * plus a numeric text-alternative table (WCAG 2.1 AA: color is never the
 * only channel). Aggregation window is a fixed 12-month rolling window.
 */

import { queryLogs, getSqliteStatus, isServiceError } from '../../dashboardSqliteService.js';
import { MAX_TIME_HEATMAP_ROWS } from '../../../utils/computeLimits.js';
import { retryWithExponentialBackoff } from '../../utils/retry.js';
import { getMessage } from '../../../utils/i18n.js';
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

export function computeHeatmapWindow(now: number): { since: number; until: number } {
  const sinceDate = new Date(now);
  sinceDate.setFullYear(sinceDate.getFullYear() - 1);
  return { since: sinceDate.getTime(), until: now };
}

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

  return {
    id: 'panel-time-heatmap',
    category: 'async-data',
    mount(container) {
      gridEl = container.querySelector('#timeHeatmapGrid');
      tableWrapEl = container.querySelector('#timeHeatmapTableWrap');
      emptyState = container.querySelector('#timeHeatmapEmptyState');
      limitNotice = container.querySelector('#timeHeatmapLimitNotice');
    },
    async load() {
      if (!gridEl || !tableWrapEl) return;

      gridEl.innerHTML = '';
      tableWrapEl.innerHTML = '';
      if (emptyState) emptyState.hidden = true;
      if (limitNotice) limitNotice.hidden = true;

      try {
        const { since, until } = computeHeatmapWindow(Date.now());
        const rows = await loadRowsWithRetry(since, until);

        if (rows.length === 0) {
          if (emptyState) emptyState.hidden = false;
          return;
        }

        if (rows.length >= MAX_TIME_HEATMAP_ROWS && limitNotice) {
          limitNotice.hidden = false;
        }

        const grid = aggregateTimeHeatmap(rows.map((r) => r.created_at));
        const max = gridMax(grid);
        gridEl.appendChild(buildHeatmapTable(grid, max));
        tableWrapEl.appendChild(buildNumericTable(grid));
      } catch (error) {
        console.error('[timeHeatmapPanel] error:', error);
        if (emptyState) emptyState.hidden = false;
      }
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

async function loadRowsWithRetry(since: number, until: number): Promise<BrowsingLogEntry[]> {
  const result = await retryWithExponentialBackoff<BrowsingLogEntry[]>(
    async () => {
      const status = await getSqliteStatus();
      if (!status?.initialized) {
        return null;
      }
      const qRes = await queryLogs({ since, until, limit: MAX_TIME_HEATMAP_ROWS });
      if (isServiceError(qRes)) {
        return null;
      }
      return qRes.data.rows;
    },
    { label: 'timeHeatmap', maxAttempts: 4 },
  );
  return result ?? [];
}
