/**
 * domainAnalysisPanel.ts (PanelLifecycle)
 * Ranked top-N tables of records per domain and per URL for a period and an
 * optional tag (PBI 2026-09-24-03). Tag+period narrowing happens at query
 * time (tagFilter + since/until); ranking of the fetched subset is
 * client-side. queryLogs caps a single page at 10000 rows, so the fetch
 * loops with offset up to MAX_DOMAIN_ANALYSIS_ROWS and shows a cap notice
 * when the last page comes back full.
 *
 * Null/blank-domain rows stay in the ranking as an (unknown) bucket
 * (visitDurationAggregate convention) with a count notice. Domain rows
 * navigate to the history panel via tryNavigateTyped({ searchDomain }) —
 * the hand-off the history panel already accepts. URL rows have no
 * navigation in v1: the history panel has no URL-targeted init param, and
 * an FTS text search of a full URL is not a reliable match.
 *
 * WHY: the Run button (or Enter in the tag input) applies both filters
 * instead of reloading on every period change — a full fetch can page
 * through up to 50k rows, so an auto-query per preset click would be
 * disproportionate.
 */

import { queryLogs, getSqliteStatus, isServiceError } from '../../dashboardSqliteService.js';
import {
  MAX_DOMAIN_ANALYSIS_ROWS,
  DOMAIN_ANALYSIS_PAGE_SIZE,
} from '../../../utils/computeLimits.js';
import { retryWithExponentialBackoff } from '../../utils/retry.js';
import { getMessage, getMessageOr } from '../../../utils/i18n.js';
import {
  createPeriodFilter,
  presetToRange,
  type PeriodFilterHandle,
  type PeriodRange,
} from '../../components/periodFilter.js';
import {
  aggregateDomainAnalysis,
  UNKNOWN_DOMAIN_LABEL,
  DOMAIN_ANALYSIS_TOP_N,
  type DomainAnalysisRankRow,
} from '../../domainAnalysisAggregate.js';
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
  let emptyState: HTMLElement | null = null;
  let unknownNotice: HTMLElement | null = null;
  let rowCapNotice: HTMLElement | null = null;
  let domainTruncated: HTMLElement | null = null;
  let urlTruncated: HTMLElement | null = null;
  let filterHandle: PeriodFilterHandle | null = null;
  let currentRange: PeriodRange = presetToRange('last30', Date.now());
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
        button.className = 'visit-duration-tag-btn';
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

  function hideNotices(): void {
    if (emptyState) emptyState.hidden = true;
    if (unknownNotice) unknownNotice.hidden = true;
    if (rowCapNotice) rowCapNotice.hidden = true;
    if (domainTruncated) domainTruncated.hidden = true;
    if (urlTruncated) urlTruncated.hidden = true;
  }

  async function reload(): Promise<void> {
    if (!domainBody || !urlBody) return;
    const seq = ++loadSeq;
    const { since, until } = currentRange;
    const tagFilter = tagInput ? toTagFilter(tagInput.value) : undefined;

    domainBody.innerHTML = '';
    urlBody.innerHTML = '';
    hideNotices();

    try {
      const { rows, capped } = await fetchAllRows(since, until, tagFilter);
      if (seq !== loadSeq) return;

      if (rows.length === 0) {
        if (emptyState) emptyState.hidden = false;
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
        unknownNotice.hidden = false;
      }
      if (capped && rowCapNotice) {
        rowCapNotice.textContent = msg(
          'domainAnalysis_rowCap',
          { max: MAX_DOMAIN_ANALYSIS_ROWS },
          'Reached the {max}-record analysis limit — showing a partial aggregation.',
        );
        rowCapNotice.hidden = false;
      }
      if (agg.domainsTruncated && domainTruncated) {
        domainTruncated.textContent = msg(
          'domainAnalysis_truncated',
          { shown: DOMAIN_ANALYSIS_TOP_N, total: agg.domainTotal },
          'Showing top {shown} of {total}.',
        );
        domainTruncated.hidden = false;
      }
      if (agg.urlsTruncated && urlTruncated) {
        urlTruncated.textContent = msg(
          'domainAnalysis_truncated',
          { shown: DOMAIN_ANALYSIS_TOP_N, total: agg.urlTotal },
          'Showing top {shown} of {total}.',
        );
        urlTruncated.hidden = false;
      }
    } catch (error) {
      console.error('[domainAnalysisPanel] error:', error);
      if (seq !== loadSeq) return;
      if (emptyState) emptyState.hidden = false;
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
      emptyState = container.querySelector('#domainAnalysisEmptyState');
      unknownNotice = container.querySelector('#domainAnalysisUnknownNotice');
      rowCapNotice = container.querySelector('#domainAnalysisRowCap');
      domainTruncated = container.querySelector('#domainAnalysisDomainTruncated');
      urlTruncated = container.querySelector('#domainAnalysisUrlTruncated');
      if (filterHost) {
        filterHandle = createPeriodFilter({
          initialPreset: 'last30',
          onChange: (range) => {
            currentRange = range;
          },
        });
        filterHost.appendChild(filterHandle.element);
        currentRange = filterHandle.getRange();
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
    },
  };
}

async function fetchPage(
  since: number | undefined,
  until: number | undefined,
  tagFilter: string | undefined,
  offset: number,
): Promise<BrowsingLogEntry[]> {
  const result = await retryWithExponentialBackoff<BrowsingLogEntry[]>(
    async () => {
      const status = await getSqliteStatus();
      if (!status?.initialized) {
        return null;
      }
      // WHY: exactOptionalPropertyTypes forbids explicit undefined — unset
      // bounds/tag pass no key rather than an undefined-valued one.
      const qRes = await queryLogs({
        ...(since !== undefined ? { since } : {}),
        ...(until !== undefined ? { until } : {}),
        ...(tagFilter !== undefined ? { tagFilter } : {}),
        limit: DOMAIN_ANALYSIS_PAGE_SIZE,
        offset,
      });
      if (isServiceError(qRes)) {
        return null;
      }
      return qRes.data.rows;
    },
    { label: 'domainAnalysis', maxAttempts: 4 },
  );
  // WHY: a failed batch must not look like "reached the end" (markdownExport
  // precedent) — a mid-pagination failure would silently aggregate a partial
  // set, so it throws and the panel falls back to the empty state instead.
  if (result === null) {
    throw new Error('domainAnalysis: query failed after retries');
  }
  return result;
}

async function fetchAllRows(
  since: number | undefined,
  until: number | undefined,
  tagFilter: string | undefined,
): Promise<{ rows: BrowsingLogEntry[]; capped: boolean }> {
  const rows: BrowsingLogEntry[] = [];
  for (let offset = 0; offset < MAX_DOMAIN_ANALYSIS_ROWS; offset += DOMAIN_ANALYSIS_PAGE_SIZE) {
    const batch = await fetchPage(since, until, tagFilter, offset);
    rows.push(...batch);
    if (batch.length < DOMAIN_ANALYSIS_PAGE_SIZE) {
      return { rows, capped: false };
    }
  }
  // WHY: a full final batch at the cap means more rows likely exist beyond
  // it — report the cap instead of implying completeness.
  return { rows, capped: true };
}
