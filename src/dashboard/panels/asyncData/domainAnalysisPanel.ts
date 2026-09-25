/**
 * domainAnalysisPanel.ts (PanelLifecycle)
 * Ranked top-N tables of records per domain and per URL for a period and an
 * optional tag (PBI 2026-09-24-03). Tag+period narrowing happens at query
 * time (tagFilter + since/until); ranking of the fetched subset is
 * client-side. queryLogs caps a single page at 10000 rows, so the fetch
 * pages with a keyset cursor (inclusive `until` = the oldest created_at of
 * the previous page) instead of offset: the recorder keeps inserting rows
 * while this aggregation runs, and an offset window over a live table
 * double-counts or skips rows. Boundary rows sharing the cursor timestamp
 * are re-read and merged by unique id, and the upper bound is frozen at
 * fetch start, so every row is counted exactly once. A cap notice shows
 * when the last page comes back full.
 *
 * Null/blank-domain rows stay in the ranking as an (unknown) bucket with a
 * count notice. Domain rows
 * navigate to the history panel via tryNavigateTyped({ searchDomain }) —
 * the hand-off the history panel already accepts. URL rows have no
 * navigation in v1: the history panel has no URL-targeted init param, and
 * an FTS text search of a full URL is not a reliable match.
 *
 * WHY: the Run button (or Enter in the tag input) applies both filters
 * instead of reloading on every period change — a full fetch can page
 * through up to 50k rows, so an auto-query per preset click would be
 * disproportionate. This is the explicit-apply shape of the period-filter
 * contract (PBI 2026-09-24-11): the panel passes no onChange handler and
 * reads getRange() at apply time — strictly less state than recording the
 * range per change.
 */

import {
  MAX_DOMAIN_ANALYSIS_ROWS,
  DOMAIN_ANALYSIS_PAGE_SIZE,
} from '../../../utils/computeLimits.js';
import { fetchAllPeriodRows } from '../fetchPeriodRows.js';
import { PanelNotices } from '../PanelNotices.js';
import { getMessageOr, getMessageWithSubstitutions as msg } from '../../../utils/i18n.js';
import {
  createPeriodFilter,
  presetToRange,
  type PeriodFilterHandle,
} from '../../components/periodFilter.js';
import {
  aggregateDomainAnalysis,
  UNKNOWN_DOMAIN_LABEL,
  DOMAIN_ANALYSIS_TOP_N,
  type DomainAnalysisRankRow,
} from '../../domainAnalysisAggregate.js';
import { tryNavigateTyped } from '../registryContext.js';
import { type PanelLifecycle } from '../types.js';

function navigateToHistoryWithDomain(domain: string): void {
  tryNavigateTyped('panel-sqlite-history', { searchDomain: domain });
}

/** Maps the tag input to a queryLogs tagFilter: trimmed, one leading # stripped. */
export function toTagFilter(raw: string): string | undefined {
  const trimmed = raw.trim().replace(/^#/, '').trim();
  return trimmed ? trimmed : undefined;
}

export function createDomainAnalysisPanel(): PanelLifecycle {
  let filterHost: HTMLElement | null = null;
  let tagInput: HTMLInputElement | null = null;
  let runButton: HTMLButtonElement | null = null;
  let domainBody: HTMLElement | null = null;
  let urlBody: HTMLElement | null = null;
  let unknownNotice: HTMLElement | null = null;
  let rowCapNotice: HTMLElement | null = null;
  let domainTruncated: HTMLElement | null = null;
  let urlTruncated: HTMLElement | null = null;
  let filterHandle: PeriodFilterHandle | null = null;
  // WHY: the empty-state element doubles as the error surface (one element,
  // two modes) — the unified failure policy swaps in the error wording. The
  // (unknown) bucket count and row cap describe the FETCH, so they are
  // fetch-scoped; the top-N truncation notices are re-decided per fetch.
  const notices = new PanelNotices();
  let loadSeq = 0;

  function renderDomainRows(rows: DomainAnalysisRankRow[]): void {
    if (!domainBody) return;
    domainBody.innerHTML = '';
    for (const row of rows) {
      const tr = document.createElement('tr');
      const nameCell = document.createElement('th');
      nameCell.scope = 'row';
      if (row.name === UNKNOWN_DOMAIN_LABEL) {
        // WHY: the unknown bucket is not a navigable domain — it is rendered
        // as localized plain text instead of a button.
        nameCell.textContent = getMessageOr('domainAnalysis_unknownDomain', UNKNOWN_DOMAIN_LABEL);
      } else {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'data-table-link-btn';
        button.textContent = row.name;
        button.addEventListener('click', () => navigateToHistoryWithDomain(row.name));
        nameCell.appendChild(button);
      }
      tr.appendChild(nameCell);
      const countCell = document.createElement('td');
      countCell.textContent = String(row.count);
      tr.appendChild(countCell);
      domainBody.appendChild(tr);
    }
  }

  function renderUrlRows(rows: DomainAnalysisRankRow[]): void {
    if (!urlBody) return;
    urlBody.innerHTML = '';
    for (const row of rows) {
      const tr = document.createElement('tr');
      const nameCell = document.createElement('th');
      nameCell.scope = 'row';
      nameCell.textContent = row.name;
      tr.appendChild(nameCell);
      const countCell = document.createElement('td');
      countCell.textContent = String(row.count);
      tr.appendChild(countCell);
      urlBody.appendChild(tr);
    }
  }

  async function reload(): Promise<void> {
    if (!domainBody || !urlBody) return;
    const seq = ++loadSeq;
    // WHY: getRange() is the single source of truth (PBI 2026-09-24-11) —
    // the explicit-apply host reads the selection at Run time instead of
    // recording it per change. The presetToRange fallback preserves the
    // pre-filter last30 default when the panel mounts without a filter host.
    const { since, until } = filterHandle
      ? filterHandle.getRange()
      : presetToRange('last30', Date.now());
    const tagFilter = tagInput ? toTagFilter(tagInput.value) : undefined;

    domainBody.innerHTML = '';
    urlBody.innerHTML = '';
    // Fresh-fetch reset: restores the normal empty binding in case a previous
    // load failed and swapped in the error message, and hides the notices
    // until this fetch's own results decide visibility.
    notices.reset();

    try {
      const { rows, capped } = await fetchAllPeriodRows({
        since,
        until,
        tagFilter,
        pageSize: DOMAIN_ANALYSIS_PAGE_SIZE,
        maxRows: MAX_DOMAIN_ANALYSIS_ROWS,
        label: 'domainAnalysis',
      });
      if (seq !== loadSeq) return;

      if (rows.length === 0) {
        notices.showEmpty();
        return;
      }

      const agg = aggregateDomainAnalysis(rows);
      renderDomainRows(agg.domains);
      renderUrlRows(agg.urls);

      if (agg.unknownDomainCount > 0 && unknownNotice) {
        unknownNotice.textContent = msg(
          'domainAnalysis_excludedNullDomainCount',
          { count: agg.unknownDomainCount },
          '{count} records have no domain and are grouped as (unknown).',
        );
        notices.show('unknown');
      }
      if (capped && rowCapNotice) {
        rowCapNotice.textContent = msg(
          'domainAnalysis_rowCap',
          { max: MAX_DOMAIN_ANALYSIS_ROWS },
          'Reached the {max}-record analysis limit — showing a partial aggregation.',
        );
        notices.show('rowCap');
      }
      if (agg.domainsTruncated && domainTruncated) {
        domainTruncated.textContent = msg(
          'domainAnalysis_truncated',
          { shown: DOMAIN_ANALYSIS_TOP_N, total: agg.domainTotal },
          'Showing top {shown} of {total}.',
        );
        notices.show('domainTruncated');
      }
      if (agg.urlsTruncated && urlTruncated) {
        urlTruncated.textContent = msg(
          'domainAnalysis_truncated',
          { shown: DOMAIN_ANALYSIS_TOP_N, total: agg.urlTotal },
          'Showing top {shown} of {total}.',
        );
        notices.show('urlTruncated');
      }
    } catch (error) {
      console.error('[domainAnalysisPanel] error:', error);
      if (seq !== loadSeq) return;
      notices.showError(
        'domainAnalysisError',
        'Failed to load the domain analysis. Try again.',
      );
    }
  }

  return {
    id: 'panel-domain-analysis',
    category: 'async-data',
    mount(container) {
      filterHost = container.querySelector('#domainAnalysisFilter');
      tagInput = container.querySelector('#domainAnalysisTagInput');
      runButton = container.querySelector('#domainAnalysisRunBtn');
      domainBody = container.querySelector('#domainAnalysisDomainBody');
      urlBody = container.querySelector('#domainAnalysisUrlBody');
      unknownNotice = container.querySelector('#domainAnalysisUnknownNotice');
      rowCapNotice = container.querySelector('#domainAnalysisRowCap');
      domainTruncated = container.querySelector('#domainAnalysisDomainTruncated');
      urlTruncated = container.querySelector('#domainAnalysisUrlTruncated');
      notices.register('empty', container.querySelector('#domainAnalysisEmptyState'), {
        i18nKey: 'domainAnalysis_empty',
        fallbackText: 'No browsing records match the selected period and tag.',
      });
      notices.register('unknown', unknownNotice, { fetchScoped: true });
      notices.register('rowCap', rowCapNotice, { fetchScoped: true });
      notices.register('domainTruncated', domainTruncated);
      notices.register('urlTruncated', urlTruncated);
      if (filterHost) {
        // WHY: no onChange handler — the panel is explicit-apply (Run button
        // or Enter), so it reads getRange() in reload() instead of recording
        // every change (PBI 2026-09-24-11).
        filterHandle = createPeriodFilter({ initialPreset: 'last30' });
        filterHost.appendChild(filterHandle.element);
      }
      runButton?.addEventListener('click', () => {
        void reload();
      });
      tagInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          void reload();
        }
      });
    },
    async load() {
      await reload();
    },
    destroy() {
      loadSeq += 1;
      filterHandle?.destroy();
      filterHandle = null;
      filterHost = null;
      tagInput = null;
      runButton = null;
      domainBody = null;
      urlBody = null;
      unknownNotice = null;
      rowCapNotice = null;
      domainTruncated = null;
      urlTruncated = null;
      notices.clear();
    },
  };
}
