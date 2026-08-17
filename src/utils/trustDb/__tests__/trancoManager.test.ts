import { describe, test, expect, vi } from 'vitest';
import { TrancoManager } from '../trancoManager.js';
import { BloomFilterManager } from '../bloomFilterManager.js';
import type { TrustDatabase } from '../trustDbSchema.js';

function makeDatabase(): TrustDatabase {
  return {
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    tranco: { tier: 'top10k', domains: [], count: 0, sizeBytes: 0 },
    jpAnchor: { tlds: [], userTlds: [] },
    sensitive: {
      presets: { finance: [], gaming: [], sns: [] },
      userBlacklist: [],
      whitelist: []
    },
    bloomFilter: { data: '', hashCount: 1, bitCount: 1, expectedDomainCount: 0, hash: '' }
  };
}

describe('TrancoManager', () => {
  test('rebuildCachesFromDatabase は trancoSet と trancoRankMap を再構築する', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const manager = new TrancoManager({ bloomFilterManager: new BloomFilterManager(), save });
    const db = makeDatabase();
    db.tranco.domains = ['a.com', 'b.com'];

    manager.rebuildCachesFromDatabase(db);

    expect(manager.trancoSet.has('a.com')).toBe(true);
    expect(manager.trancoSet.has('b.com')).toBe(true);
    expect(manager.trancoRankMap.get('a.com')).toBe(0);
    expect(manager.trancoRankMap.get('b.com')).toBe(1);
  });

  test('updateTranco はデータベース・キャッシュを更新し保存する', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const manager = new TrancoManager({ bloomFilterManager: new BloomFilterManager(), save });
    const db = makeDatabase();

    const { bloomFilter } = await manager.updateTranco(db, ['cnn.com', 'bbc.com'], 'top10k');

    expect(db.tranco.domains).toEqual(['cnn.com', 'bbc.com']);
    expect(db.tranco.count).toBe(2);
    expect(db.tranco.tier).toBe('top10k');
    expect(manager.trancoSet.has('cnn.com')).toBe(true);
    expect(manager.trancoRankMap.get('bbc.com')).toBe(1);
    expect(bloomFilter.mightContain('cnn.com')).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
  });

  test('isTrancoDomain は trancoSet を参照して判定する', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const manager = new TrancoManager({ bloomFilterManager: new BloomFilterManager(), save });
    manager.trancoSet = new Set(['cnn.com']);

    expect(manager.isTrancoDomain('cnn.com')).toBe(true);
    expect(manager.isTrancoDomain('https://cnn.com/path')).toBe(true);
    expect(manager.isTrancoDomain('unknown.com')).toBe(false);
  });
});
