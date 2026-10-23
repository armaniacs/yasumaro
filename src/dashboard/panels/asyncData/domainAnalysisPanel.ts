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
import { getMessageOr, getMessageWithSubstitutions as msg, tOrKey as t } from '../../../utils/i18n.js';
import { clearElement } from '../../../utils/domClear.js';
import { setElementHtml } from '../../../utils/htmlFragment.js';
import { createAsyncDataPanelLifecycle } from './asyncDataPanelLifecycle.js';
import { showRowCapNotice } from '../rowCapNotice.js';
import {
  aggregateDomainAnalysis,
  UNKNOWN_DOMAIN_LABEL,
  DOMAIN_ANALYSIS_TOP_N,
  type DomainAnalysisRankRow,
} from '../../domainAnalysisAggregate.js';
import { tryNavigateTyped } from '../registryContext.js';
import { type PanelLifecycle } from '../types.js';
import { logError } from '../../../utils/logger/api.js';
import { ErrorCode } from '../../../utils/logger/types.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import {
  computeSourceBias,
  buildNoiseProposals,
  periodBasisLabel,
  sharePercent,
  type NoiseProposal,
} from '../../domainIntelAggregate.js';
import { addDomainToBlacklist, removeDomainFromBlacklist } from '../../../utils/storage/domainIntelRepository.js';
import { formatLocalDateString } from '../../../utils/localDate.js';
import { escapeHtml } from '../../../utils/htmlEscape.js';
import { wireProposalRow as wireSharedProposalRow } from '../../proposalRowWiring.js';

function navigateToHistoryWithDomain(domain: string): void {
  tryNavigateTyped('panel-sqlite-history', { searchDomain: domain });
}

/** Maps the tag input to a queryLogs tagFilter: trimmed, one leading # stripped. */
export function toTagFilter(raw: string): string | undefined {
  const trimmed = raw.trim().replace(/^#/, '').trim();
  return trimmed ? trimmed : undefined;
}

export function createDomainAnalysisPanel(): PanelLifecycle {
  let tagInput: HTMLInputElement | null = null;
  let runButton: HTMLButtonElement | null = null;
  let domainBody: HTMLElement | null = null;
  let urlBody: HTMLElement | null = null;
  let unknownNotice: HTMLElement | null = null;
  let rowCapNotice: HTMLElement | null = null;
  let domainTruncated: HTMLElement | null = null;
  let urlTruncated: HTMLElement | null = null;
  // Domain-intel section (PBI 2026-10-23-10): bias line + exclusion proposals.
  let intelBiasLine: HTMLElement | null = null;
  let intelProposals: HTMLElement | null = null;
  // WHY: the empty-state element doubles as the error surface (one element,
  // two modes) — the unified failure policy swaps in the error wording. The
  // (unknown) bucket count and row cap describe the FETCH, so they are
  // fetch-scoped; the top-N truncation notices are re-decided per fetch.
  const notices = new PanelNotices();

  // One row skeleton shared by both rankings (th[scope=row] name cell + count
  // td); the caller supplies how the name cell renders (button for domains,
  // plain text for URLs). Keeps the two tables' DOM identical to the former
  // per-table loops.
  function appendRankRow(
    body: HTMLElement,
    row: DomainAnalysisRankRow,
    renderNameCell: (row: DomainAnalysisRankRow) => HTMLTableCellElement,
  ): void {
    const tr = document.createElement('tr');
    tr.appendChild(renderNameCell(row));
    const countCell = document.createElement('td');
    countCell.textContent = String(row.count);
    tr.appendChild(countCell);
    body.appendChild(tr);
  }

  function renderRankRows(
    body: HTMLElement,
    rows: DomainAnalysisRankRow[],
    renderNameCell: (row: DomainAnalysisRankRow) => HTMLTableCellElement,
  ): void {
    clearElement(body);
    for (const row of rows) appendRankRow(body, row, renderNameCell);
  }

  function domainNameCell(row: DomainAnalysisRankRow): HTMLTableCellElement {
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
    return nameCell;
  }

  function plainNameCell(row: DomainAnalysisRankRow): HTMLTableCellElement {
    const nameCell = document.createElement('th');
    nameCell.scope = 'row';
    nameCell.textContent = row.name;
    return nameCell;
  }

  function clearRankBodies(): void {
    if (domainBody) clearElement(domainBody);
    if (urlBody) clearElement(urlBody);
  }

  // --- Domain intel (PBI 2026-10-23-10) --------------------------------------

  function hideIntel(): void {
    if (intelBiasLine) intelBiasLine.hidden = true;
    if (intelProposals) {
      intelProposals.hidden = true;
      clearElement(intelProposals);
    }
  }

  /**
   * Exclusion proposal apply/undo (BDD: 見直しを適用できる). Applying is a
   * user action with an inline undo — nothing fires automatically
   * (自動除外はしない). The undo restores the blacklist instead of the
   * previous panel state, so the action is reversible end-to-end.
   */
  function wireProposalActions(row: HTMLElement, proposal: NoiseProposal): void {
    wireSharedProposalRow(
      row,
      {
        apply: '[data-intel-action="apply"]',
        undo: '[data-intel-action="undo"]',
        status: '.domain-intel-status',
      },
      {
        apply: async () => {
          await addDomainToBlacklist(proposal.domain);
          // 適用後は取り消せる: the undo appears in place of the apply button.
          return msg('domainIntel_applied', { domain: proposal.domain }, `${proposal.domain} を記録対象外にしました。`);
        },
        undo: async () => {
          await removeDomainFromBlacklist(proposal.domain);
          return msg('domainIntel_undone', { domain: proposal.domain }, `${proposal.domain} の記録対象外を取り消しました。`);
        },
      },
    );
  }

  function buildProposalRow(proposal: NoiseProposal): string {
    const percent = sharePercent(proposal.share);
    return `<div class="domain-intel-proposal-row">
      <div class="domain-intel-proposal-info">
        <span class="domain-intel-proposal-domain">${escapeHtml(proposal.domain)}</span>
        <div class="domain-intel-proposal-meta">${escapeHtml(msg('domainIntel_proposalMeta', { count: proposal.count, percent }, `${proposal.count} 件 (割合 ${percent}%)`))}</div>
      </div>
      <div class="domain-intel-proposal-actions">
        <button type="button" class="secondary-btn" data-intel-action="apply"
          data-intel-domain="${escapeHtml(proposal.domain)}">${escapeHtml(t('domainIntel_applyBtn'))}</button>
        <button type="button" class="secondary-btn" data-intel-action="undo" hidden
          data-intel-domain="${escapeHtml(proposal.domain)}">${escapeHtml(t('domainIntel_undoBtn'))}</button>
      </div>
      <div class="domain-intel-status" role="status" aria-live="polite"></div>
    </div>`;
  }

  function renderIntel(agg: ReturnType<typeof aggregateDomainAnalysis>, range: { since: number | null; until: number | null }): void {
    if (!intelBiasLine || !intelProposals) return;
    // 少件数の縮退: below the minimum the panel shows the reason instead of a
    // share judgment built on a handful of rows.
    const bias = computeSourceBias(agg, range);
    if (!bias.enough) {
      intelBiasLine.textContent = msg('domainIntel_notEnough', { count: bias.total }, `記録が ${bias.total} 件のため偏りを判定できません。`);
      intelBiasLine.hidden = false;
      hideIntelProposalsOnly();
      return;
    }
    // 断定口調にしない: the share line states the basis (件数・期間・算出式),
    // not a verdict.
    const periodLabel = periodBasisLabel(bias.since, bias.until, formatLocalDateString);
    intelBiasLine.textContent = msg('domainIntel_biasLine', {
      domain: bias.topDomain ?? '',
      percent: sharePercent(bias.topShare),
      total: bias.total,
      period: periodLabel,
      formula: bias.formula,
    }, `${bias.topDomain} が全 ${bias.total} 件のうち約 ${sharePercent(bias.topShare)}% を占めています。偏っている可能性があります。`);
    intelBiasLine.hidden = false;

    const proposals = buildNoiseProposals(agg);
    if (proposals.length === 0) {
      hideIntelProposalsOnly();
      return;
    }
    setElementHtml(intelProposals, `
      <p class="domain-intel-help">${escapeHtml(t('domainIntel_proposalHelp'))}</p>
      ${proposals.map(buildProposalRow).join('')}`);
    intelProposals.hidden = false;
    const rows = intelProposals.querySelectorAll<HTMLElement>('.domain-intel-proposal-row');
    proposals.forEach((proposal, index) => {
      const row = rows[index];
      if (row) wireProposalActions(row, proposal);
    });
  }

  function hideIntelProposalsOnly(): void {
    if (intelProposals) {
      intelProposals.hidden = true;
      clearElement(intelProposals);
    }
  }

  const lifecycle = createAsyncDataPanelLifecycle({
    label: 'domainAnalysisPanel',
    notices: [notices],
    filterHostSelector: '#domainAnalysisFilter',
    // WHY: no auto-apply — the panel is explicit-apply (Run button or Enter),
    // so it reads getRange() at apply time instead of recording every change
    // (PBI 2026-09-24-11).
    initialPreset: 'last30',
    isReady: () => domainBody !== null && urlBody !== null,
    resetOutput: () => {
      clearRankBodies();
    },
    // WHY: isReady() already gated this load; the check narrows the captured
    // hosts for the body.
    load: async ({ range, isStale }) => {
      if (!domainBody || !urlBody) return;
      const { since, until } = range;
      const tagFilter = tagInput ? toTagFilter(tagInput.value) : undefined;

      try {
        const { rows, capped } = await fetchAllPeriodRows({
          since,
          until,
          tagFilter,
          pageSize: DOMAIN_ANALYSIS_PAGE_SIZE,
          maxRows: MAX_DOMAIN_ANALYSIS_ROWS,
          label: 'domainAnalysis',
        });
        if (isStale()) return;

        if (rows.length === 0) {
          notices.showEmpty();
          // 空集合では偏りの判定面も隠す: 前回の render が残らない。
          hideIntel();
          return;
        }

        const agg = aggregateDomainAnalysis(rows);
        renderRankRows(domainBody, agg.domains, domainNameCell);
        renderRankRows(urlBody, agg.urls, plainNameCell);
        // The intel section rides the same fetch's period basis (件数・期間);
        // unbounded endpoints pass through as null and the basis shows it.
        renderIntel(agg, { since: since ?? null, until: until ?? null });

        if (agg.unknownDomainCount > 0 && unknownNotice) {
          unknownNotice.textContent = msg(
            'domainAnalysis_excludedNullDomainCount',
            { count: agg.unknownDomainCount },
            '{count} records have no domain and are grouped as (unknown).',
          );
          notices.show('unknown');
        }
        if (capped) {
          showRowCapNotice({
            notices,
            messageKey: 'domainAnalysis_rowCap',
            fallback: 'Reached the {max}-record analysis limit — showing a partial aggregation.',
            shown: rows.length,
            limit: MAX_DOMAIN_ANALYSIS_ROWS,
          });
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
        // User notice via notices.showError stays; the cause now also goes
        // through the structured-log seam instead of console.
        void logError('[domainAnalysisPanel] load failed', { error: errorMessage(error) }, ErrorCode.STORAGE_READ_FAILURE, 'domainAnalysisPanel');
        if (isStale()) return;
        notices.showError(
          'domainAnalysisError',
          'Failed to load the domain analysis. Try again.',
        );
      }
    },
  });

  return {
    id: 'panel-domain-analysis',
    category: 'async-data',
    mount(container) {
      tagInput = container.querySelector('#domainAnalysisTagInput');
      runButton = container.querySelector('#domainAnalysisRunBtn');
      domainBody = container.querySelector('#domainAnalysisDomainBody');
      urlBody = container.querySelector('#domainAnalysisUrlBody');
      unknownNotice = container.querySelector('#domainAnalysisUnknownNotice');
      rowCapNotice = container.querySelector('#domainAnalysisRowCap');
      domainTruncated = container.querySelector('#domainAnalysisDomainTruncated');
      urlTruncated = container.querySelector('#domainAnalysisUrlTruncated');
      // Domain-intel section (PBI 2026-10-23-10).
      intelBiasLine = container.querySelector('#domainIntelBiasLine');
      intelProposals = container.querySelector('#domainIntelProposals');
      notices.register('empty', container.querySelector('#domainAnalysisEmptyState'), {
        i18nKey: 'domainAnalysis_empty',
        fallbackText: 'No browsing records match the selected period and tag.',
      });
      notices.register('unknown', unknownNotice, { fetchScoped: true });
      notices.register('rowCap', rowCapNotice, { fetchScoped: true });
      notices.register('domainTruncated', domainTruncated);
      notices.register('urlTruncated', urlTruncated);
      lifecycle.mount(container);
      runButton?.addEventListener('click', () => {
        void lifecycle.reload();
      });
      tagInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          void lifecycle.reload();
        }
      });
    },
    async load() {
      await lifecycle.reload();
    },
    destroy() {
      lifecycle.destroy();
      tagInput = null;
      runButton = null;
      domainBody = null;
      urlBody = null;
      unknownNotice = null;
      rowCapNotice = null;
      domainTruncated = null;
      urlTruncated = null;
      intelBiasLine = null;
      intelProposals = null;
    },
  };
}
