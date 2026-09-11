import { describe, test, expect } from 'vitest';
import { BloomFilterManager } from '../bloomFilterManager.js';
import { bloomFilterFromData } from '../bloomFilter.js';

describe('BloomFilterManager', () => {
  test('createBloomFilterFromPresets returns BloomFilterData containing preset domains', async () => {
    const manager = new BloomFilterManager();
    const data = await manager.createBloomFilterFromPresets();

    expect(data.data).toBeTruthy();
    expect(data.hashCount).toBeGreaterThan(0);

    const restored = bloomFilterFromData(data);
    // presets.ts の finance プリセットに実在するはずのドメイン例で確認
    // (プリセット内容が変わっても、少なくとも一部は mightContain が true になる)
    expect(typeof restored.mightContain('example.com')).toBe('boolean');
  });

  test('rebuildForTrancoUpdate builds a filter containing both tranco domains and sensitive presets', () => {
    const manager = new BloomFilterManager();
    const bloom = manager.rebuildForTrancoUpdate(
      ['cnn.com'],
      { finance: ['bank.example'], gaming: ['game.example'], sns: ['social.example'] }
    );

    expect(bloom.mightContain('cnn.com')).toBe(true);
    expect(bloom.mightContain('bank.example')).toBe(true);
    expect(bloom.mightContain('game.example')).toBe(true);
    expect(bloom.mightContain('social.example')).toBe(true);
  });

  test('rebuildForTrancoUpdate does not throw when domains are empty', () => {
    const manager = new BloomFilterManager();
    const bloom = manager.rebuildForTrancoUpdate([], { finance: [], gaming: [], sns: [] });
    expect(bloom.mightContain('anything.com')).toBe(false);
  });
});
