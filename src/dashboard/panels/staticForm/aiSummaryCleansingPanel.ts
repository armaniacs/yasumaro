import { type PanelLifecycle } from '../types.js';
import { logWarn } from '../../../utils/logger/api.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import {
  getAiSummaryCleansingSettings, applyAiSummaryCleansingSettingsToUI,
  setupAiSummaryCleansingEventListeners,
} from '../../settings/aiSummaryCleansingSettingsV2.js';
import { initPerSiteOverrides } from '../../settings/perSiteOverrides.js';
import { getSavedUrlEntries } from '../../../utils/storageUrls.js';
import { computeCleansingStats, renderStatsSummary, renderFunnelChart } from '../../cleansingStatsView.js';
import { renderCleansingFeedback } from '../../cleansingFeedbackView.js';

export function createAiSummaryCleansingPanel(): PanelLifecycle & { refresh?: () => Promise<void> } {
  let panelContainer: HTMLElement | null = null;
  return {
    id: 'panel-ai-summary-cleansing',
    category: 'static-form',
    async mount(container) {
      panelContainer = container;
      const aiSummaryCleansingSettings = await getAiSummaryCleansingSettings();
      applyAiSummaryCleansingSettingsToUI(aiSummaryCleansingSettings);
      // The threshold sliders' `input` mirror and their single-key `change`
      // delta write are wired here too: binding them in this module as well
      // made one slider gesture run two writes, the whole-form one first.
      setupAiSummaryCleansingEventListeners();
      // A failed per-site init must not break the whole panel mount, but it
      // leaves the overrides UI dead — keep it visible in diagnostic logs
      // (was silent).
      try {
        initPerSiteOverrides();
      } catch (error: unknown) {
        void logWarn('aiSummaryCleansingPanel: per-site overrides init failed', { error: errorMessage(error) }, undefined, 'aiSummaryCleansingPanel');
      }
      const feedbackContainer = container.querySelector('#cleansingFeedbackContainer') as HTMLElement | null;
      if (feedbackContainer) {
        // Best-effort feedback render; NavigationRegistry's panel-load-error
        // path stays the backstop for mount-level failures.
        renderCleansingFeedback(feedbackContainer).catch((error: unknown) => {
          void logWarn('aiSummaryCleansingPanel: feedback render failed', { error: errorMessage(error) }, undefined, 'aiSummaryCleansingPanel');
        });
      }
    },
    async refresh() {
      const container = panelContainer;
      if (container) {
        const settings = await getAiSummaryCleansingSettings();
        applyAiSummaryCleansingSettingsToUI(settings);
      }
    },
    init() {
      const summaryEl = document.getElementById('cleansingStatsSummary') as HTMLElement | null;
      const chartEl = document.getElementById('cleansingFunnelChart') as HTMLCanvasElement | null;
      if (!summaryEl) return;
      getSavedUrlEntries().then(panelEntries => {
        const stats = computeCleansingStats(panelEntries);
        renderStatsSummary(summaryEl, stats);
        if (chartEl) {
          chartEl.style.display = stats.count === 0 ? 'none' : 'block';
          if (stats.count > 0) renderFunnelChart(chartEl, stats);
        }
      }).catch(() => {});
    },
  };
}
