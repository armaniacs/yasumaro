/**
 * visitDurationPanel.ts (PanelLifecycle)
 * Renders per-domain and per-tag total/average visit-time rankings for the
 * period selected in the shared periodFilter component (PBI 2026-09-24-02).
 * Rows with null visit_duration are excluded from sums and reported as an
 * unmeasured ratio. Tag rows navigate to history with the tag (same
 * tryNavigateTyped + navigate-to-tag fallback as tagClusterPanel);
 * domain rows have no navigation in v1.
 */

import { queryLogs, getSqliteStatus, isServiceError } from '../../dashboardSqliteService.js';
import { MAX_VISIT_DURATION_ROWS } from '../../../utils/computeLimits.js';
import { retryWithExponentialBackoff } from '../../utils/retry.js';
import { getMessage, getMessageOr } from '../../../utils/i18n.js';
import {
  createPeriodFilter,
  presetToRange,
  type PeriodFilterHandle,
  type PeriodRange,
} from '../../components/periodFilter.js';
import {
  aggregateVisitDurations,
  formatVisitDuration,
  VISIT_DURATION_TOP_N,
  type VisitDurationRankRow,
} from '../../visitDurationAggregate.js';
import type { BrowsingLogEntry } from '../../dashboardSqliteService.js';
import { tryNavigateTyped } from '../registryContext.js';
import { type PanelLifecycle } from '../types.js';

/** getMessage with {name} substitutions and an English fallback template. */
function msg(key: string, subs: Record<string, string | number>, fallback: string): string {
  const translated = getMessage(key, subs);
  if (translated) return translated;
  return fallback.replace(/\{(\w+)\}/g, (_, name: string) =>
    subs[name] !== undefined ? String(subs[name]) : `{${name}}`,
  );
}

function navigateToHistoryWithTag(tag: string): void {
  const fallback = (): void => {
    document.dispatchEvent(new CustomEvent('navigate-to-tag', { detail: tag }));
  };
  tryNavigateTyped('panel-sqlite-history', { searchTag: tag }, fallback);
}

export function createVisitDurationPanel(): PanelLifecycle {
  let filterHost: HTMLElement | null = null;
  let domainBody: HTMLElement | null = null;
  let tagBody: HTMLElement | null = null;
  let emptyState: HTMLElement | null = null;
  let allUnmeasured: HTMLElement | null = null;
  let ratioEl: HTMLElement | null = null;
  let domainTruncated: HTMLElement | null = null;
  let tagTruncated: HTMLElement | null = null;
  let filterHandle: PeriodFilterHandle | null = null;
  let currentRange: PeriodRange = presetToRange('last30', Date.now());
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

  function renderRows(tbody: HTMLElement, rows: VisitDurationRankRow[], isTag: boolean): void {
    tbody.innerHTML = '';
    for (const row of rows) {
      const tr = document.createElement('tr');
      const nameCell = document.createElement('th');
      nameCell.scope = 'row';
      if (isTag) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'visit-duration-tag-btn';
        button.textContent = '#' + row.name;
        button.addEventListener('click', () => navigateToHistoryWithTag(row.name));
        nameCell.appendChild(button);
      } else {
        nameCell.textContent = row.name;
      }
      tr.appendChild(nameCell);
      const totalCell = document.createElement('td');
      totalCell.textContent = formatVisitDuration(row.totalMs);
      tr.appendChild(totalCell);
      const avgCell = document.createElement('td');
      avgCell.textContent = formatVisitDuration(row.avgMs);
      tr.appendChild(avgCell);
      const countCell = document.createElement('td');
      countCell.textContent = String(row.count);
      tr.appendChild(countCell);
      tbody.appendChild(tr);
    }
  }

  async function reload(): Promise<void> {
    if (!domainBody || !tagBody) return;
    const seq = ++loadSeq;
    const { since, until } = currentRange;

    domainBody.innerHTML = '';
    tagBody.innerHTML = '';
    if (emptyState) emptyState.hidden = true;
    // WHY: restore the normal empty-state binding in case a previous load
    // failed and swapped in the error message.
    setEmptyStateMessage('visitDurationEmpty', 'No browsing records in this period.');
    if (allUnmeasured) allUnmeasured.hidden = true;
    if (ratioEl) ratioEl.hidden = true;
    if (domainTruncated) domainTruncated.hidden = true;
    if (tagTruncated) tagTruncated.hidden = true;

    try {
      const rows = await loadRowsWithRetry(since, until);
      if (seq !== loadSeq) return;

      if (rows.length === 0) {
        if (emptyState) emptyState.hidden = false;
        return;
      }

      const agg = aggregateVisitDurations(rows);

      if (ratioEl) {
        const percent = Math.round(agg.unmeasuredRatio * 100);
        ratioEl.textContent = msg(
          'visitDurationUnmeasuredRatio',
          { percent, unmeasured: agg.unmeasuredCount, total: agg.totalCount },
          'Unmeasured: {percent}% ({unmeasured} of {total} records)',
        );
        ratioEl.hidden = false;
      }

      if (agg.measuredCount === 0) {
        if (allUnmeasured) allUnmeasured.hidden = false;
        return;
      }

      renderRows(domainBody, agg.domains, false);
      renderRows(tagBody, agg.tags, true);

      if (agg.domainsTruncated && domainTruncated) {
        domainTruncated.textContent = msg(
          'visitDurationTruncated',
          { shown: VISIT_DURATION_TOP_N, total: agg.domainTotal },
          'Showing top {shown} of {total}.',
        );
        domainTruncated.hidden = false;
      }
      if (agg.tagsTruncated && tagTruncated) {
        tagTruncated.textContent = msg(
          'visitDurationTruncated',
          { shown: VISIT_DURATION_TOP_N, total: agg.tagTotal },
          'Showing top {shown} of {total}.',
        );
        tagTruncated.hidden = false;
      }
    } catch (error) {
      console.error('[visitDurationPanel] error:', error);
      if (seq !== loadSeq) return;
      setEmptyStateMessage(
        'visitDurationError',
        'Failed to load the visit duration analysis. Try again.',
      );
      if (emptyState) emptyState.hidden = false;
    }
  }

  return {
    id: 'panel-visit-duration',
    category: 'async-data',
    mount(container) {
      filterHost = container.querySelector('#visitDurationFilter');
      domainBody = container.querySelector('#visitDurationDomainBody');
      tagBody = container.querySelector('#visitDurationTagBody');
      emptyState = container.querySelector('#visitDurationEmptyState');
      allUnmeasured = container.querySelector('#visitDurationAllUnmeasured');
      ratioEl = container.querySelector('#visitDurationUnmeasuredRatio');
      domainTruncated = container.querySelector('#visitDurationDomainTruncated');
      tagTruncated = container.querySelector('#visitDurationTagTruncated');
      if (filterHost) {
        filterHandle = createPeriodFilter({
          initialPreset: 'last30',
          onChange: (range) => {
            currentRange = range;
            // WHY: the filter emits once during construction; arming the
            // reload trigger only after that initial emission prevents a
            // duplicate load when mount finishes (tagClusterPanel pattern).
            if (filterReady) void reload();
          },
        });
        filterHost.appendChild(filterHandle.element);
        currentRange = filterHandle.getRange();
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
      domainBody = null;
      tagBody = null;
    },
  };
}

async function loadRowsWithRetry(since: number | undefined, until: number | undefined): Promise<BrowsingLogEntry[]> {
  const result = await retryWithExponentialBackoff<BrowsingLogEntry[]>(
    async () => {
      const status = await getSqliteStatus();
      if (!status?.initialized) {
        return null;
      }
      // WHY: exactOptionalPropertyTypes forbids explicit undefined — 'all'
      // passes no bounds rather than undefined-valued keys.
      const qRes = await queryLogs({
        ...(since !== undefined ? { since } : {}),
        ...(until !== undefined ? { until } : {}),
        limit: MAX_VISIT_DURATION_ROWS,
      });
      if (isServiceError(qRes)) {
        return null;
      }
      return qRes.data.rows;
    },
    { label: 'visitDuration', maxAttempts: 4 },
  );
  // WHY: a failed query must not render as "no records" — throw so the
  // panel's catch shows a distinct error state (wordClusterPanel convention).
  if (result === null) {
    throw new Error('visitDuration: query failed after retries');
  }
  return result;
}
