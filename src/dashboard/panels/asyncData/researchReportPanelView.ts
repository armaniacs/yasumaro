/**
 * researchReportPanelView.ts
 *
 * Research-report region of the SQLite history panel (PBI 2026-10-23-09).
 * 調査レポート一発生成: one button that turns the panel conditions into the
 * four-section Markdown (要旨・時系列・引用・未読穴) and delivers it through the
 * existing export paths. Region-scoped render entry — same contract as
 * renderAskHistoryRegion: the shell placeholder `<div id="sqlite-research-report">`
 * is owned by buildPanelShellHtml, but the id string itself is owned here
 * (RESEARCH_REPORT_REGION_ID); the view only re-exports it for the shell.
 * This module fills it.
 */

import { tOrKey as t } from '../../../utils/i18n.js';
import { escapeHtml } from '../../../utils/htmlEscape.js';
import { setElementHtml } from '../../../utils/htmlFragment.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { localDayRangeFromDateString } from '../../../utils/localDate.js';
import { withBusyButton } from './busyButton.js';
import { exportResearchReport } from '../../../messaging/researchReportGateway.js';
import { toReportRunResult, type ReportRunResult } from '../../../messaging/responseRepack.js';
import type { ResearchReportScope } from '../../../messaging/responseCanonical.js';

export type { ReportRunResult } from '../../../messaging/responseRepack.js';

/**
 * Canonical owner of the research-report region placeholder id. The view keeps
 * a compatibility entry in SQLITE_HISTORY_IDS that references this constant,
 * so the string has a single source without moving the shell markup.
 */
export const RESEARCH_REPORT_REGION_ID = 'sqlite-research-report';

/** Event bundle the region owns and hands to the region renderer. */
export interface ResearchReportRegionActions {
  /** Generate one report; the region owns the gateway call and timeout mapping. */
  onGenerate: (sendToObsidian: boolean) => Promise<ReportRunResult>;
}

/** Narrow panel-condition source the report scope is built from. */
export interface ResearchReportScopeSource {
  searchQuery: string;
  activeTagFilter: string | null;
  selectedDate: string | null;
}

/**
 * Build the report scope from the current panel conditions. Owned here
 * (PBI 2026-10-24-05) so the selected day / search / tag shaping no longer
 * lives in the panel closure.
 */
export function buildResearchReportScope(source: ResearchReportScopeSource): ResearchReportScope {
  const scope: ResearchReportScope = {};
  if (source.searchQuery.trim().length > 0) scope.search = source.searchQuery.trim();
  if (source.activeTagFilter !== null && source.activeTagFilter.trim().length > 0) {
    scope.tag = source.activeTagFilter.trim();
  }
  if (source.selectedDate !== null) {
    // The selected day is the report scope (PBI 06 collection shape).
    const range = localDayRangeFromDateString(source.selectedDate);
    scope.since = range.since;
    scope.until = range.until;
  }
  return scope;
}

/**
 * Region-owned action bundle for the research report (PBI 2026-10-24-05).
 * Wire-to-view repack lives in the seam module (responseRepack.ts); this
 * factory only builds the scope from the Panel-supplied source. The Panel
 * passes a source accessor and keeps no generate logic itself.
 */
export function createResearchReportActions(
  getSource: () => ResearchReportScopeSource,
): ResearchReportRegionActions {
  async function generateReport(sendToObsidian: boolean): Promise<ReportRunResult> {
    try {
      const scope = buildResearchReportScope(getSource());
      const result = await exportResearchReport({ scope, sendToObsidian });
      return toReportRunResult(result);
    } catch (error) {
      // Defensive default: the gateway always resolves (timeout arrives as a
      // SendFailure), so this catch only covers unexpected throws.
      return { ok: false, error: errorMessage(error) };
    }
  }

  return {
    onGenerate: (sendToObsidian) => generateReport(sendToObsidian),
  };
}

function buildRegionInnerHtml(): string {
  return `<div class="research-report-section">
    <h4 data-i18n="researchReportLabel">${escapeHtml(t('researchReportLabel'))}</h4>
    <p class="research-report-help" data-i18n="researchReportHelp">${escapeHtml(t('researchReportHelp'))}</p>
    <div class="research-report-input">
      <label class="research-report-obsidian">
        <input type="checkbox" class="research-report-obsidian-check" />
        <span data-i18n="researchReportObsidianOption">${escapeHtml(t('researchReportObsidianOption'))}</span>
      </label>
      <button type="button" class="secondary-btn" data-report-action="generate">${escapeHtml(t('researchReportGenerateBtn'))}</button>
    </div>
    <div class="research-report-status" role="status" aria-live="polite"></div>
  </div>`;
}

/**
 * Region-scoped render entry for the research-report region. The shell
 * placeholder is owned by buildPanelShellHtml; this function fills it and
 * wires the generate control. Status survives until the next wholesale
 * re-render.
 */
export function renderResearchReportRegion(
  container: HTMLElement,
  actions: ResearchReportRegionActions,
): void {
  const region = container.querySelector(`#${RESEARCH_REPORT_REGION_ID}`);
  if (!(region instanceof HTMLElement)) return;

  setElementHtml(region, buildRegionInnerHtml());

  const generateButton = region.querySelector<HTMLButtonElement>('[data-report-action="generate"]');
  const obsidianCheck = region.querySelector<HTMLInputElement>('.research-report-obsidian-check');
  const statusEl = region.querySelector<HTMLElement>('.research-report-status');
  if (!generateButton) return;

  generateButton.addEventListener('click', () => {
    void (async () => {
      await withBusyButton(generateButton, async () => {
        if (statusEl) statusEl.textContent = t('researchReportBusy');
        try {
          const result = await actions.onGenerate(obsidianCheck?.checked === true);
          if (!result.ok) {
            if (statusEl) statusEl.textContent = result.error ?? t('researchReportFailed');
            return;
          }
          if (statusEl) {
            const count = result.recordCount ?? 0;
            statusEl.textContent = t('researchReportDone', [String(count)]);
          }
        } catch (error) {
          if (statusEl) {
            statusEl.textContent = error instanceof Error ? error.message : t('researchReportFailed');
          }
        }
      });
    })();
  });
}
