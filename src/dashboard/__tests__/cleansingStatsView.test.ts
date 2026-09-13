// @vitest-environment jsdom

import { computeCleansingStats, renderStatsSummary, renderFunnelChart, makeCleansingProgressBar } from '../cleansingStatsView.js';
import type { SavedUrlEntry } from '../../utils/storageUrls.js';

describe('computeCleansingStats', () => {
  it('returns count=0 when there is no data', () => {
    const stats = computeCleansingStats([]);
    expect(stats.count).toBe(0);
    expect(stats.avgReductionRate).toBe(0);
    expect(stats.totalSavedBytes).toBe(0);
  });

  it('does not count entries with only pageBytes', () => {
    const entries: SavedUrlEntry[] = [
      { url: 'https://a.com', timestamp: 1, pageBytes: 10000 }
    ];
    const stats = computeCleansingStats(entries);
    expect(stats.count).toBe(0);
  });

  it('aggregates entries having both pageBytes and aiSummaryCleansedBytes', () => {
    const entries: SavedUrlEntry[] = [
      {
        url: 'https://a.com',
        timestamp: 1,
        pageBytes: 10000,
        candidateBytes: 6000,
        cleansedBytes: 5000,
        aiSummaryCleansedBytes: 4000,
      },
      {
        url: 'https://b.com',
        timestamp: 2,
        pageBytes: 20000,
        candidateBytes: 12000,
        cleansedBytes: 10000,
        aiSummaryCleansedBytes: 8000,
      }
    ];
    const stats = computeCleansingStats(entries);
    expect(stats.count).toBe(2);
    expect(stats.avgFinalBytes).toBe(6000);
    expect(stats.avgReductionRate).toBeCloseTo(60, 1);
    expect(stats.totalSavedBytes).toBe(18000);
    expect(stats.funnelAvg.page).toBe(15000);
    expect(stats.funnelAvg.candidate).toBe(9000);
    expect(stats.funnelAvg.cleansed).toBe(7500);
    expect(stats.funnelAvg.aiCleansed).toBe(6000);
  });

  it('uses cleansedBytes as the final value when aiSummaryCleansedBytes is absent', () => {
    const entries: SavedUrlEntry[] = [
      {
        url: 'https://c.com',
        timestamp: 3,
        pageBytes: 8000,
        cleansedBytes: 4000,
      }
    ];
    const stats = computeCleansingStats(entries);
    expect(stats.count).toBe(1);
    expect(stats.avgFinalBytes).toBe(4000);
    expect(stats.avgReductionRate).toBeCloseTo(50, 1);
  });
});

describe('renderFunnelChart', () => {
  it('does not draw on canvas and does not throw when count=0', () => {
    const canvas = document.createElement('canvas') as HTMLCanvasElement;
    const stats = computeCleansingStats([]);
    expect(() => renderFunnelChart(canvas, stats)).not.toThrow();
  });

  it('does not throw when called with valid data', () => {
    const canvas = document.createElement('canvas') as HTMLCanvasElement;
    const entries: SavedUrlEntry[] = [
      {
        url: 'https://a.com',
        timestamp: 1,
        pageBytes: 10000,
        candidateBytes: 6000,
        cleansedBytes: 5000,
        aiSummaryCleansedBytes: 4000,
      }
    ];
    const stats = computeCleansingStats(entries);
    expect(() => renderFunnelChart(canvas, stats)).not.toThrow();
  });
});

describe('makeCleansingProgressBar', () => {
  it('returns null when pageBytes is missing', () => {
    const entry: SavedUrlEntry = { url: 'https://a.com', timestamp: 1 };
    expect(makeCleansingProgressBar(entry)).toBeNull();
  });

  it('returns null when only pageBytes is present', () => {
    const entry: SavedUrlEntry = { url: 'https://a.com', timestamp: 1, pageBytes: 10000 };
    expect(makeCleansingProgressBar(entry)).toBeNull();
  });

  it('returns an HTMLElement when pageBytes and aiSummaryOriginalBytes are present', () => {
    const entry: SavedUrlEntry = {
      url: 'https://a.com',
      timestamp: 1,
      pageBytes: 10000,
      aiSummaryOriginalBytes: 4000,
    };
    const el = makeCleansingProgressBar(entry);
    expect(el).not.toBeNull();
    expect(el!.querySelector('.cleansing-progress-bar')).not.toBeNull();
    const bar = el!.querySelector('.cleansing-progress-bar') as HTMLElement;
    expect(bar.style.width).toBe('40%');
    expect(el!.textContent).toContain('60.0% reduction');
  });

  it('works when aiSummaryCleansedBytes is absent but cleansedBytes is present', () => {
    const entry: SavedUrlEntry = {
      url: 'https://a.com',
      timestamp: 1,
      pageBytes: 8000,
      cleansedBytes: 2000,
    };
    const el = makeCleansingProgressBar(entry);
    expect(el).not.toBeNull();
    const bar = el!.querySelector('.cleansing-progress-bar') as HTMLElement;
    expect(bar.style.width).toBe('25%');
    expect(el!.textContent).toContain('75.0% reduction');
  });

  it('returns null when pageBytes is 0', () => {
    const entry: SavedUrlEntry = {
      url: 'https://a.com',
      timestamp: 1,
      pageBytes: 0,
      cleansedBytes: 0,
    };
    expect(makeCleansingProgressBar(entry)).toBeNull();
  });

  it('uses cleansedBytes as sentToAI when fallbackTriggered is true', () => {
    const entry: SavedUrlEntry = {
      url: 'https://a.com',
      timestamp: 1,
      pageBytes: 10000,
      cleansedBytes: 3000,
      aiSummaryCleansedBytes: 500,
      fallbackTriggered: true,
    };
    const el = makeCleansingProgressBar(entry);
    expect(el).not.toBeNull();
    // fallback時は aiSummaryCleansedBytes ではなく cleansedBytes (3000) を使う
    const bar = el!.querySelector('.cleansing-progress-bar') as HTMLElement;
    expect(bar.style.width).toBe('30%');
    expect(el!.textContent).toContain('70.0% reduction');
  });

  it('formats byte display in MB correctly (>= 1MB)', () => {
    const entry: SavedUrlEntry = {
      url: 'https://a.com',
      timestamp: 1,
      pageBytes: 3 * 1024 * 1024,
      cleansedBytes: 1 * 1024 * 1024,
    };
    const el = makeCleansingProgressBar(entry);
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain('MB');
  });

  it('formats byte display in KB correctly (>= 1KB, < 1MB)', () => {
    const entry: SavedUrlEntry = {
      url: 'https://a.com',
      timestamp: 1,
      pageBytes: 5000,
      cleansedBytes: 2000,
    };
    const el = makeCleansingProgressBar(entry);
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain('KB');
  });

  it('formats byte display in B correctly (< 1KB)', () => {
    const entry: SavedUrlEntry = {
      url: 'https://a.com',
      timestamp: 1,
      pageBytes: 800,
      cleansedBytes: 200,
    };
    const el = makeCleansingProgressBar(entry);
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain(' B');
  });
});

describe('renderStatsSummary', () => {
  it('shows no-data class and message when count=0', () => {
    const container = document.createElement('div');
    const stats = computeCleansingStats([]);
    renderStatsSummary(container, stats);
    expect(container.className).toBe('cleansing-stats-summary no-data');
    expect(container.textContent).toContain('No reduction rate data available');
  });

  it('renders stat cards when count>0', () => {
    const container = document.createElement('div');
    const entries: SavedUrlEntry[] = [
      {
        url: 'https://a.com',
        timestamp: 1,
        pageBytes: 10000,
        aiSummaryCleansedBytes: 4000,
      }
    ];
    const stats = computeCleansingStats(entries);
    renderStatsSummary(container, stats);
    expect(container.className).toBe('cleansing-stats-summary');
    expect(container.innerHTML).toContain('stats-card');
    expect(container.innerHTML).toContain('Avg. Reduction Rate');
    expect(container.innerHTML).toContain('Total Saved');
    expect(container.innerHTML).toContain('Records');
  });

  it('renders stat cards with correct values', () => {
    const container = document.createElement('div');
    const entries: SavedUrlEntry[] = [
      {
        url: 'https://a.com',
        timestamp: 1,
        pageBytes: 10000,
        aiSummaryCleansedBytes: 4000,
      }
    ];
    const stats = computeCleansingStats(entries);
    renderStatsSummary(container, stats);
    expect(container.innerHTML).toContain('60.0%');
    expect(container.innerHTML).toContain('5.859 KB');
    expect(container.innerHTML).toContain('1 record(s)');
  });
});