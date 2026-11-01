import { tOrKey as t } from '../../../utils/i18n.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { type PanelLifecycle } from '../types.js';
import {
  createAskHistoryActions,
  renderAskHistoryRegion,
} from './askHistoryPanelView.js';
import { getSavedCollections } from '../../../utils/storage/savedCollectionsRepository.js';
import type { SavedCollection } from '../../../utils/storage/savedCollections.js';

/**
 * askHistoryPanel.ts (PBI 2026-11-01-02)
 *
 * Standalone sibling of the history panel: owns the question + target
 * collection selection with panel-local state. The region view
 * (askHistoryPanelView) and the generation path (askHistoryGateway via
 * createAskHistoryActions) are reused unchanged; only the collection supply
 * differs from the history wiring — this panel loads the list DIRECTLY from
 * the saved-collections repository instead of reading the history panel's
 * state, so no shared state with history exists by construction.
 *
 * Behavior preserved from the history region: the busy button doubles as
 * the double-execution guard, the gateway keeps its 60s budget, refusal
 * reasons paint into the status line, and a failed run stays retryable.
 */

/** Placeholder id inside this panel's static section (the history shell keeps its own). */
export const ASK_HISTORY_PANEL_REGION_ID = 'ask-history-panel-region';

export function createAskHistoryPanel(): PanelLifecycle {
  let container: HTMLElement | null = null;
  let savedCollections: Record<string, SavedCollection> = {};

  /** Same translation as the history panel: i18n keys pass through t(), raw errors stay raw. */
  function translatePanelError(error: string): string {
    return error.startsWith('Error: ') ? error : t(error);
  }

  function clearLoadError(): void {
    container?.querySelector('.ask-history-load-error')?.remove();
  }

  function renderLoadError(error: unknown): void {
    if (!container) return;
    clearLoadError();
    const alert = document.createElement('div');
    alert.className = 'ask-history-load-error';
    alert.setAttribute('role', 'alert');
    alert.textContent = errorMessage(error);
    container.appendChild(alert);
  }

  function renderAsk(): void {
    if (!container) return;
    renderAskHistoryRegion(
      container,
      savedCollections,
      createAskHistoryActions(translatePanelError),
      ASK_HISTORY_PANEL_REGION_ID,
    );
  }

  async function loadAsk(): Promise<void> {
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
      renderAsk();
    }
  }

  return {
    id: 'panel-ask-history',
    category: 'async-data',
    mount(c: HTMLElement) {
      container = c;
    },
    async load() {
      if (!container) return;
      await loadAsk();
    },
    destroy() {
      container = null;
      savedCollections = {};
    },
  };
}
