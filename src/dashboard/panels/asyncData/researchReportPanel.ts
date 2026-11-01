import { errorMessage } from '../../../utils/errorUtils.js';
import { type PanelLifecycle } from '../types.js';
import {
  createResearchReportPanelActions,
  renderResearchReportPanelRegion,
} from './researchReportPanelView.js';
import { getSavedCollections } from '../../../utils/storage/savedCollectionsRepository.js';
import type { SavedCollection } from '../../../utils/storage/savedCollections.js';

/**
 * researchReportPanel.ts (PBI 2026-11-01-03)
 *
 * Standalone sibling of the history panel: owns the target collection
 * selection with panel-local state. The region view
 * (researchReportPanelView) and the generation path (exportResearchReport
 * via createResearchReportPanelActions) are reused; only the target supply
 * differs from the history wiring — this panel resolves the report scope
 * (term/tag/period) from the SELECTED SAVED COLLECTION instead of the
 * history panel's search conditions, so no shared state with history exists
 * by construction. No dedicated condition inputs are built.
 *
 * Behavior preserved from the history region: the busy button doubles as
 * the double-execution guard, the gateway keeps its 60s budget, the
 * no-target/send failure reason paints into the status line, and a failed
 * run stays retryable (resend).
 */

/** Placeholder id inside this panel's static section (the history shell keeps its own). */
export const RESEARCH_REPORT_PANEL_REGION_ID = 'research-report-panel-region';

export function createResearchReportPanel(): PanelLifecycle {
  let container: HTMLElement | null = null;
  let savedCollections: Record<string, SavedCollection> = {};

  function clearLoadError(): void {
    container?.querySelector('.research-report-load-error')?.remove();
  }

  function renderLoadError(error: unknown): void {
    if (!container) return;
    clearLoadError();
    const alert = document.createElement('div');
    alert.className = 'research-report-load-error';
    alert.setAttribute('role', 'alert');
    alert.textContent = errorMessage(error);
    container.appendChild(alert);
  }

  function renderReport(): void {
    if (!container) return;
    renderResearchReportPanelRegion(
      container,
      savedCollections,
      createResearchReportPanelActions(() => savedCollections),
      RESEARCH_REPORT_PANEL_REGION_ID,
    );
  }

  async function loadReport(): Promise<void> {
    if (!container) return;
    const target = container;
    try {
      savedCollections = await getSavedCollections();
    } catch (error) {
      // Contained in-panel: the failure reason paints here and load()
      // still resolves, so the history panel and the registry banner stay
      // out of it. (The repository itself degrades to {} on a read failure;
      // this catch covers unexpected throws around it.)
      if (container === target) renderLoadError(error);
      return;
    }
    if (container === target) {
      clearLoadError();
      renderReport();
    }
  }

  return {
    id: 'panel-research-report',
    category: 'async-data',
    mount(c: HTMLElement) {
      container = c;
    },
    async load() {
      if (!container) return;
      await loadReport();
    },
    destroy() {
      container = null;
      savedCollections = {};
    },
  };
}
