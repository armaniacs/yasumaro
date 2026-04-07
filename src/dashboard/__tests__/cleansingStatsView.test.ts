import { describe, it, expect } from '@jest/globals';
import { computeCleansingStats, renderFunnelChart, makeCleansingProgressBar } from '../cleansingStatsView.js';
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

  it('pageBytes と aiSummaryCleansedBytes がある場合 HTMLElement を返す', () => {
    const entry: SavedUrlEntry = {
      url: 'https://a.com',
      timestamp: 1,
      pageBytes: 10000,
      aiSummaryCleansedBytes: 4000,
    };
    const el = makeCleansingProgressBar(entry);
    expect(el).not.toBeNull();
    expect(el!.querySelector('.cleansing-progress-bar')).not.toBeNull();
    const bar = el!.querySelector('.cleansing-progress-bar') as HTMLElement;
    expect(bar.style.width).toBe('40.0%');
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
    expect(bar.style.width).toBe('25.0%');
    expect(el!.textContent).toContain('75.0% 削減');
  });
});