import { computeCleansingStats, renderStatsSummary, renderFunnelChart } from './cleansingStatsView.js';
import type { SavedUrlEntry } from '../utils/storageUrls.js';

export function updateCleansingStatsPanel(panelEntries: SavedUrlEntry[]): void {
  const summaryEl = document.getElementById('cleansingStatsSummary') as HTMLElement | null;
  const chartEl = document.getElementById('cleansingFunnelChart') as HTMLCanvasElement | null;
  if (!summaryEl) return;
  const stats = computeCleansingStats(panelEntries);
  renderStatsSummary(summaryEl, stats);
  if (chartEl) {
    if (stats.count === 0) {
      chartEl.style.display = 'none';
    } else {
      chartEl.style.display = 'block';
      renderFunnelChart(chartEl, stats);
    }
  }
}
