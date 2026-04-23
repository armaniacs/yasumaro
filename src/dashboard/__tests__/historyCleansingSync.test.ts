// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { updateCleansingStatsPanel } from '../historyCleansingSync.js';

const mockCompute = vi.fn();
const mockRenderSummary = vi.fn();
const mockRenderChart = vi.fn();

vi.mock('../cleansingStatsView.js', () => ({
  computeCleansingStats: (...args: unknown[]) => mockCompute(...args),
  renderStatsSummary: (...args: unknown[]) => mockRenderSummary(...args),
  renderFunnelChart: (...args: unknown[]) => mockRenderChart(...args),
}));

describe('updateCleansingStatsPanel', () => {
  beforeEach(() => {
    mockCompute.mockReset();
    mockRenderSummary.mockReset();
    mockRenderChart.mockReset();
    document.body.innerHTML = `
      <div id="cleansingStatsSummary"></div>
      <canvas id="cleansingFunnelChart"></canvas>
    `;
  });

  it('renders summary with stats', () => {
    mockCompute.mockReturnValue({ count: 5, cleansed: 3 });
    updateCleansingStatsPanel([]);
    expect(mockCompute).toHaveBeenCalledWith([]);
    expect(mockRenderSummary).toHaveBeenCalled();
  });

  it('hides chart when count is 0', () => {
    mockCompute.mockReturnValue({ count: 0 });
    updateCleansingStatsPanel([]);
    const chartEl = document.getElementById('cleansingFunnelChart') as HTMLCanvasElement;
    expect(chartEl.style.display).toBe('none');
    expect(mockRenderChart).not.toHaveBeenCalled();
  });

  it('shows and renders chart when count > 0', () => {
    mockCompute.mockReturnValue({ count: 3 });
    updateCleansingStatsPanel([]);
    const chartEl = document.getElementById('cleansingFunnelChart') as HTMLCanvasElement;
    expect(chartEl.style.display).toBe('block');
    expect(mockRenderChart).toHaveBeenCalled();
  });

  it('does nothing when summary element is missing', () => {
    document.body.innerHTML = '';
    mockCompute.mockReturnValue({ count: 5 });
    updateCleansingStatsPanel([]);
    expect(mockRenderSummary).not.toHaveBeenCalled();
  });
});
