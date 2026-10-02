import { type PanelLifecycle } from '../types.js';
import {
  getAiSummaryCleansingSettings, applyAiSummaryCleansingSettingsToUI,
  setupAiSummaryCleansingEventListeners,
} from '../../settings/aiSummaryCleansingSettingsV2.js';
import { initPerSiteOverrides } from '../../settings/perSiteOverrides.js';
import { getSavedUrlEntries } from '../../../utils/storageUrls.js';
import { settingsRepository } from '../../../utils/storage/SettingsRepository.js';
import { StorageKeys, type Settings } from '../../../utils/storage/types.js';
import { computeCleansingStats, renderStatsSummary, renderFunnelChart } from '../../cleansingStatsView.js';
import { renderCleansingFeedback } from '../../cleansingFeedbackView.js';

/** The four threshold keys the sliders below own, as storage keys. */
type CleansingThresholdStorageKey =
  | typeof StorageKeys.AI_SUMMARY_CLEANSING_LINK_RATIO_THRESHOLD
  | typeof StorageKeys.AI_SUMMARY_CLEANSING_SHORT_TEXT_THRESHOLD
  | typeof StorageKeys.AI_SUMMARY_CLEANSING_SHORT_SEQ_COUNT
  | typeof StorageKeys.AI_SUMMARY_CLEANSING_LINK_PARA_THRESHOLD;

export function createAiSummaryCleansingPanel(): PanelLifecycle & { refresh?: () => Promise<void> } {
  let panelContainer: HTMLElement | null = null;
  return {
    id: 'panel-ai-summary-cleansing',
    category: 'static-form',
    async mount(container) {
      panelContainer = container;
      const aiSummaryCleansingSettings = await getAiSummaryCleansingSettings();
      applyAiSummaryCleansingSettingsToUI(aiSummaryCleansingSettings);
      setupAiSummaryCleansingEventListeners();
      try { initPerSiteOverrides(); } catch {}
      const feedbackContainer = container.querySelector('#cleansingFeedbackContainer') as HTMLElement | null;
      if (feedbackContainer) {
        renderCleansingFeedback(feedbackContainer).catch(() => {});
      }

      const sliderConfigs: { sliderId: string; valueId: string; storageKey: CleansingThresholdStorageKey }[] = [
        { sliderId: 'ai-summary-cleansing-link-ratio-threshold', valueId: 'link-ratio-threshold-value', storageKey: StorageKeys.AI_SUMMARY_CLEANSING_LINK_RATIO_THRESHOLD },
        { sliderId: 'ai-summary-cleansing-short-text-threshold', valueId: 'short-text-threshold-value', storageKey: StorageKeys.AI_SUMMARY_CLEANSING_SHORT_TEXT_THRESHOLD },
        { sliderId: 'ai-summary-cleansing-short-seq-count', valueId: 'short-seq-count-value', storageKey: StorageKeys.AI_SUMMARY_CLEANSING_SHORT_SEQ_COUNT },
        { sliderId: 'ai-summary-cleansing-link-para-threshold', valueId: 'link-para-threshold-value', storageKey: StorageKeys.AI_SUMMARY_CLEANSING_LINK_PARA_THRESHOLD },
      ];

      for (const config of sliderConfigs) {
        const slider = container.querySelector(`#${config.sliderId}`) as HTMLInputElement;
        const valueDisplay = container.querySelector(`#${config.valueId}`) as HTMLElement;
        if (slider && valueDisplay) {
          slider.addEventListener('input', () => {
            valueDisplay.textContent = slider.value;
          });
          slider.addEventListener('change', async () => {
            // Delta write: the moved slider's key alone enters the payload, so a
            // sibling key a concurrent writer changed between the form's read and
            // this write is not reverted by a getAll() snapshot. setAll merges
            // the payload over storage re-read fresh under the write lock.
            const delta: Partial<Settings> = { [config.storageKey]: parseInt(slider.value, 10) };
            await settingsRepository.setAll(delta);
          });
        }
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
