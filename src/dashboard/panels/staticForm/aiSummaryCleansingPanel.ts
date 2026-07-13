import { type StaticFormPanel } from '../types.js';
import { getSettings } from '../../../utils/storage.js';
import {
  getAiSummaryCleansingSettings, applyAiSummaryCleansingSettingsToUI,
  setupAiSummaryCleansingEventListeners, saveAiSummaryCleansingSettings,
  getAiSummaryCleansingSettingsFromUI,
} from '../../../popup/aiSummaryCleansingSettingsV2.js';
import { getSavedUrlEntries } from '../../../utils/storageUrls.js';
import { computeCleansingStats, renderStatsSummary, renderFunnelChart } from '../../cleansingStatsView.js';

export function createAiSummaryCleansingPanel(): StaticFormPanel {
  return {
    id: 'panel-ai-summary-cleansing',
    category: 'static-form',
    async mount(container) {
      const aiSummaryCleansingSettings = await getAiSummaryCleansingSettings();
      applyAiSummaryCleansingSettingsToUI(aiSummaryCleansingSettings);
      setupAiSummaryCleansingEventListeners();

      const sliderConfigs = [
        { sliderId: 'ai-summary-cleansing-link-ratio-threshold', valueId: 'link-ratio-threshold-value', settingKey: 'linkRatioThreshold' },
        { sliderId: 'ai-summary-cleansing-short-text-threshold', valueId: 'short-text-threshold-value', settingKey: 'shortTextThreshold' },
        { sliderId: 'ai-summary-cleansing-short-seq-count', valueId: 'short-seq-count-value', settingKey: 'shortSeqCount' },
        { sliderId: 'ai-summary-cleansing-link-para-threshold', valueId: 'link-para-threshold-value', settingKey: 'linkParaThreshold' },
      ];

      for (const config of sliderConfigs) {
        const slider = container.querySelector(`#${config.sliderId}`) as HTMLInputElement;
        const valueDisplay = container.querySelector(`#${config.valueId}`) as HTMLElement;
        if (slider && valueDisplay) {
          slider.addEventListener('input', () => {
            valueDisplay.textContent = slider.value;
          });
          slider.addEventListener('change', async () => {
            const s = await getAiSummaryCleansingSettings();
            const ss = s as unknown as Record<string, number>;
            ss[config.settingKey] = parseInt(slider.value, 10);
            await saveAiSummaryCleansingSettings(s);
          });
        }
      }
    },
    async refresh() {
      const container = document.getElementById('panel-ai-summary-cleansing');
      if (container) {
        const settings = await getAiSummaryCleansingSettings();
        applyAiSummaryCleansingSettingsToUI(settings);
      }
    },
    onActivate() {
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
