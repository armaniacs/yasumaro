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
 * The standalone panel section (PBI 2026-11-01-03) passes its own region id
 * instead and renders the target-collection select. This module fills both.
 */

import { tOrKey as t } from '../../../utils/i18n.js';
import { escapeHtml } from '../../../utils/htmlEscape.js';
import { escapeCssSelector } from '../../../utils/cssUtils.js';
import { setElementHtml } from '../../../utils/htmlFragment.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { localDayRangeFromDateString } from '../../../utils/localDate.js';
import { withBusyButton } from './busyButton.js';
import { exportResearchReport } from '../../../messaging/researchReportGateway.js';
import { toReportRunResult, type ReportRunResult } from '../../../messaging/responseRepack.js';
import type { ResearchReportScope } from '../../../messaging/responseCanonical.js';
import type { SavedCollection } from '../../../utils/storage/savedCollections.js';
import { parseCollectionQuery } from './savedCollectionQuery.js';

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

/**
 * Resolve the report target from the SELECTED SAVED COLLECTION
 * (PBI 2026-11-01-03). The standalone panel owns no condition inputs and
 * never reads the history shell's search conditions; term/tag/day come from
 * the stored collection query only. A corrupted stored shape fails closed to
 * the empty scope, and a non-finite day range is dropped instead of sending
 * NaN downstream.
 */
export function buildResearchReportScopeFromCollection(
  query: Record<string, unknown>,
): ResearchReportScope {
  const parsed = parseCollectionQuery(query);
  const scope: ResearchReportScope = {};
  if (parsed.search !== '') scope.search = parsed.search;
  if (parsed.tag !== null) scope.tag = parsed.tag;
  if (parsed.date !== null) {
    const range = localDayRangeFromDateString(parsed.date);
    if (Number.isFinite(range.since) && Number.isFinite(range.until)) {
      scope.since = range.since;
      scope.until = range.until;
    }
  }
  return scope;
}

/** Event bundle the standalone panel region owns (collection + generate). */
export interface ResearchReportPanelActions {
  /** Generate one report for the selected collection; null is all records. */
  onGenerate: (collectionId: string | null, sendToObsidian: boolean) => Promise<ReportRunResult>;
}

/**
 * Region-owned action bundle for the standalone report panel. The scope is
 * resolved from the stored collection query at generate time; an unknown id
 * degrades to the empty scope (whole-history, capped downstream). The
 * generation path is the existing exportResearchReport seam, so the top-200
 * cap, unread holes, reason display and resend behavior are unchanged.
 */
export function createResearchReportPanelActions(
  getCollections: () => Record<string, SavedCollection>,
): ResearchReportPanelActions {
  async function generateReport(collectionId: string | null, sendToObsidian: boolean): Promise<ReportRunResult> {
    try {
      const stored: Record<string, SavedCollection | undefined> = getCollections();
      const selected = collectionId === null ? undefined : stored[collectionId];
      const scope = selected === undefined
        ? {}
        : buildResearchReportScopeFromCollection(selected.query);
      const result = await exportResearchReport({ scope, sendToObsidian });
      return toReportRunResult(result);
    } catch (error) {
      // Defensive default: the gateway always resolves (timeout arrives as a
      // SendFailure), so this catch only covers unexpected throws.
      return { ok: false, error: errorMessage(error) };
    }
  }

  return {
    onGenerate: (collectionId, sendToObsidian) => generateReport(collectionId, sendToObsidian),
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
 * re-render. The history path stays selector-free (PBI 04 owns the slimming).
 */
export function renderResearchReportRegion(
  container: HTMLElement,
  actions: ResearchReportRegionActions,
  regionId: string = RESEARCH_REPORT_REGION_ID,
): void {
  const region = container.querySelector(`#${escapeCssSelector(regionId)}`);
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

function buildPanelRegionInnerHtml(collections: Record<string, SavedCollection>): string {
  const entries = Object.values(collections).sort((a, b) => b.updatedAt - a.updatedAt);
  const options = [`<option value="">${escapeHtml(t('researchReportTargetAll'))}</option>`]
    .concat(entries.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`))
    .join('');
  return `<div class="research-report-section">
    <h4 data-i18n="researchReportLabel">${escapeHtml(t('researchReportLabel'))}</h4>
    <p class="research-report-help" data-i18n="researchReportPanelHelp">${escapeHtml(t('researchReportPanelHelp'))}</p>
    <div class="research-report-input">
      <select class="research-report-target" aria-label="${escapeHtml(t('researchReportTargetLabel'))}">${options}</select>
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
 * Region-scoped render entry for the standalone report panel
 * (PBI 2026-11-01-03). The placeholder lives in the panel's own static
 * section; this function fills it with the target-collection select and
 * wires the generate control. The target resolves from the selected saved
 * collection only — no condition inputs, no history-shell reads. Failure
 * keeps the button retryable (resend), and the busy button doubles as the
 * double-execution guard.
 */
export function renderResearchReportPanelRegion(
  container: HTMLElement,
  collections: Record<string, SavedCollection>,
  actions: ResearchReportPanelActions,
  regionId: string,
): void {
  const region = container.querySelector(`#${escapeCssSelector(regionId)}`);
  if (!(region instanceof HTMLElement)) return;

  setElementHtml(region, buildPanelRegionInnerHtml(collections));

  const generateButton = region.querySelector<HTMLButtonElement>('[data-report-action="generate"]');
  const targetSelect = region.querySelector<HTMLSelectElement>('.research-report-target');
  const obsidianCheck = region.querySelector<HTMLInputElement>('.research-report-obsidian-check');
  const statusEl = region.querySelector<HTMLElement>('.research-report-status');
  if (!generateButton) return;

  generateButton.addEventListener('click', () => {
    void (async () => {
      await withBusyButton(generateButton, async () => {
        if (statusEl) statusEl.textContent = t('researchReportBusy');
        try {
          const selected = targetSelect?.value ?? '';
          const result = await actions.onGenerate(
            selected === '' ? null : selected,
            obsidianCheck?.checked === true,
          );
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
