// @vitest-environment jsdom

import { computeCleansingStats, renderStatsSummary, renderFunnelChart, makeCleansingProgressBar } from '../cleansingStatsView.js';
import type { SavedUrlEntry } from '../../utils/storageUrls.js';

describe('computeCleansingStats', () => {
  it('データなしのとき count=0 を返す', () => {
    const stats = computeCleansingStats([]);
    expect(stats.count).toBe(0);
    expect(stats.avgReductionRate).toBe(0);
    expect(stats.totalSavedBytes).toBe(0);
  });

  it('pageBytes のみのエントリはカウントしない', () => {
    const entries: SavedUrlEntry[] = [
      { url: 'https://a.com', timestamp: 1, pageBytes: 10000 }
    ];
    const stats = computeCleansingStats(entries);
    expect(stats.count).toBe(0);
  });

  it('pageBytes と aiSummaryCleansedBytes が両方あるエントリを集計する', () => {
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

  it('aiSummaryCleansedBytes がないとき cleansedBytes を最終値として使う', () => {
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
  it('count=0 のとき canvas に何も描画せずエラーにならない', () => {
    const canvas = document.createElement('canvas') as HTMLCanvasElement;
    const stats = computeCleansingStats([]);
    expect(() => renderFunnelChart(canvas, stats)).not.toThrow();
  });

  it('有効なデータで呼び出してもエラーにならない', () => {
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
  it('pageBytes がない場合 null を返す', () => {
    const entry: SavedUrlEntry = { url: 'https://a.com', timestamp: 1 };
    expect(makeCleansingProgressBar(entry)).toBeNull();
  });

  it('pageBytes のみある場合 null を返す', () => {
    const entry: SavedUrlEntry = { url: 'https://a.com', timestamp: 1, pageBytes: 10000 };
    expect(makeCleansingProgressBar(entry)).toBeNull();
  });

  it('pageBytes と aiSummaryOriginalBytes がある場合 HTMLElement を返す', () => {
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
    expect(el!.textContent).toContain('60.0% 削減');
  });

  it('aiSummaryCleansedBytes がなく cleansedBytes がある場合も機能する', () => {
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
    expect(el!.textContent).toContain('75.0% 削減');
  });

  it('pageBytes が 0 の場合 null を返す', () => {
    const entry: SavedUrlEntry = {
      url: 'https://a.com',
      timestamp: 1,
      pageBytes: 0,
      cleansedBytes: 0,
    };
    expect(makeCleansingProgressBar(entry)).toBeNull();
  });

  it('fallbackTriggered が true の場合 cleansedBytes を sentToAI として使う', () => {
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
    expect(el!.textContent).toContain('70.0% 削減');
  });

  it('MB単位のバイト表示が正しい（>= 1MB）', () => {
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

  it('KB単位のバイト表示が正しい（>= 1KB, < 1MB）', () => {
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

  it('B単位のバイト表示が正しい（< 1KB）', () => {
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
  it('count=0 のとき no-data クラスとメッセージを表示', () => {
    const container = document.createElement('div');
    const stats = computeCleansingStats([]);
    renderStatsSummary(container, stats);
    expect(container.className).toBe('cleansing-stats-summary no-data');
    expect(container.textContent).toContain('削減率データがありません');
  });

  it('count>0 のとき統計カードを描画', () => {
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
    expect(container.innerHTML).toContain('平均削減率');
    expect(container.innerHTML).toContain('累計削減量');
    expect(container.innerHTML).toContain('集計対象');
  });

  it('統計カードの値が正しい', () => {
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
    expect(container.innerHTML).toContain('1件');
  });
});