/**
 * researchReportPanelView.ts
 *
 * Research-report region of the SQLite history panel (PBI 2026-10-23-09).
 * 調査レポート一発生成: one button that turns the panel conditions into the
 * four-section Markdown (要旨・時系列・引用・未読穴) and delivers it through the
 * existing export paths. Region-scoped render entry — same contract as
 * renderAskHistoryRegion: the shell placeholder `<div id="sqlite-research-report">`
 * is owned by buildPanelShellHtml (its id lives in SQLITE_HISTORY_IDS, the sole
 * owner of every panel DOM id); this module fills it.
 */

import { tOrKey as t } from '../../../utils/i18n.js';
import { escapeHtml } from '../../../utils/htmlEscape.js';
import { setElementHtml } from '../../../utils/htmlFragment.js';
import { withBusyButton } from './busyButton.js';
import { SQLITE_HISTORY_IDS } from './sqliteHistoryPanelView.js';

/** Outcome of one report run, as the Panel normalizes it from the wire. */
export interface ReportRunResult {
  ok: boolean;
  error?: string;
  recordCount?: number;
  deliveredTo?: ('download' | 'obsidian')[];
}

/** Event bundle the Panel builds once and hands to the region renderer. */
export interface ResearchReportRegionActions {
  /** Generate one report; the Panel owns the gateway call and timeout mapping. */
  onGenerate: (sendToObsidian: boolean) => Promise<ReportRunResult>;
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
  const region = container.querySelector(`#${SQLITE_HISTORY_IDS.researchReport}`);
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
