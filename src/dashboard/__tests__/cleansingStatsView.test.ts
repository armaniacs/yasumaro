import { describe, it, expect } from '@jest/globals';
import { computeCleansingStats } from '../cleansingStatsView.js';
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