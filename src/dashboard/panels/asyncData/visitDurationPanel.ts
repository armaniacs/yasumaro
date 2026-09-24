/**
 * visitDurationPanel.ts (PanelLifecycle)
 * Renders per-domain and per-tag total/average visit-time rankings for the
 * period selected in the shared periodFilter component (PBI 2026-09-24-02).
 * Rows with null visit_duration are excluded from sums and reported as an
 * unmeasured ratio. Tag rows navigate to history with the tag via the
 * shared navigateToHistoryWithTag helper;
 * domain rows have no navigation in v1.
 */

import { MAX_VISIT_DURATION_ROWS } from '../../../utils/computeLimits.js';
import { fetchPeriodRows } from '../fetchPeriodRows.js';
import { PanelNotices } from '../PanelNotices.js';
import { getMessageWithSubstitutions as msg } from '../../../utils/i18n.js';
import {
  createPeriodFilter,
  presetToRange,
  type PeriodFilterHandle,
} from '../../components/periodFilter.js';
import {
  aggregateVisitDurations,
  formatVisitDuration,
  VISIT_DURATION_TOP_N,
  type VisitDurationRankRow,
  } from '../../visitDurationAggregate.js';
import { navigateToHistoryWithTag } from '../navigateToHistory.js';
import { type PanelLifecycle } from '../types.js';

export function createVisitDurationPanel(): PanelLifecycle {
  let filterHost: HTMLElement | null = null;
  let domainBody: HTMLElement | null = null;
  let tagBody: HTMLElement | null = null;
  let ratioEl: HTMLElement | null = null;
  let domainTruncated: HTMLElement | null = null;
  let tagTruncated: HTMLElement | null = null;
  let filterHandle: PeriodFilterHandle | null = null;
  // WHY: the empty-state element doubles as the error surface (one element,
  // two modes); the unmeasured ratio and truncation notices are re-decided
  // from each fetch's own aggregation, so plain (non-fetch-scoped) entries.
  const notices = new PanelNotices();
  let loadSeq = 0;

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
    // WHY: getRange() is the single source of truth (PBI 2026-09-24-11). The
    // presetToRange fallback preserves the pre-filter last30 default when the
    // panel mounts without a filter host.
    const { since, until } = filterHandle
      ? filterHandle.getRange()
      : presetToRange('last30', Date.now());

    domainBody.innerHTML = '';
    tagBody.innerHTML = '';
    // Fresh-fetch reset: restores the normal empty binding in case a previous
    // load failed and swapped in the error message, and hides the ratio /
    // all-unmeasured / truncation notices until this fetch's results decide.
    notices.reset();

    try {
      const fetched = await fetchPeriodRows({
        since,
        until,
        limit: MAX_VISIT_DURATION_ROWS,
        label: 'visitDuration',
      });
      const rows = fetched.rows;
      if (seq !== loadSeq) return;

      if (rows.length === 0) {
        notices.showEmpty();
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
        notices.show('ratio');
      }

      if (agg.measuredCount === 0) {
        notices.show('allUnmeasured');
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
        notices.show('domainTruncated');
      }
      if (agg.tagsTruncated && tagTruncated) {
        tagTruncated.textContent = msg(
          'visitDurationTruncated',
          { shown: VISIT_DURATION_TOP_N, total: agg.tagTotal },
          'Showing top {shown} of {total}.',
        );
        notices.show('tagTruncated');
      }
    } catch (error) {
      console.error('[visitDurationPanel] error:', error);
      if (seq !== loadSeq) return;
      notices.showError(
        'visitDurationError',
        'Failed to load the visit duration analysis. Try again.',
      );
    }
  }

  return {
    id: 'panel-visit-duration',
    category: 'async-data',
    mount(container) {
      filterHost = container.querySelector('#visitDurationFilter');
      domainBody = container.querySelector('#visitDurationDomainBody');
      tagBody = container.querySelector('#visitDurationTagBody');
      ratioEl = container.querySelector('#visitDurationUnmeasuredRatio');
      domainTruncated = container.querySelector('#visitDurationDomainTruncated');
      tagTruncated = container.querySelector('#visitDurationTagTruncated');
      notices.register('empty', container.querySelector('#visitDurationEmptyState'), {
        i18nKey: 'visitDurationEmpty',
        fallbackText: 'No browsing records in this period.',
      });
      notices.register('allUnmeasured', container.querySelector('#visitDurationAllUnmeasured'));
      notices.register('ratio', ratioEl);
      notices.register('domainTruncated', domainTruncated);
      notices.register('tagTruncated', tagTruncated);
      if (filterHost) {
        filterHandle = createPeriodFilter({
          initialPreset: 'last30',
          onChange: () => {
            // WHY: auto-apply on selection (tagClusterPanel pattern) — each
            // load is a single capped query. Construction emits nothing
            // (PBI 2026-09-24-11), so firing reload directly is
            // duplicate-safe.
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
      domainBody = null;
      tagBody = null;
      ratioEl = null;
      domainTruncated = null;
      tagTruncated = null;
      notices.clear();
    },
  };
}
