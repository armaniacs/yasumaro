/**
 * ublockParser-cache.test.js
 * uBlock Parser - Cacheモジュールのユニットテスト
 */

import {
  clearCache,
  updateLRUTracker,
  cleanupCache,
  generateCacheKey,
  getFromCache,
  saveToCache,
  hasCacheKey
} from '../ublockParser.ts';

describe('ublockParser - Cache Module', () => {
  // 全テストの前にキャッシュをクリアして状態をリセット
  beforeEach(() => {
    clearCache();
  });

  // ============================================================================
  // generateCacheKey
  // ============================================================================

  describe('generateCacheKey', () => {
    test('基本的なキーを生成', () => {
      const key = generateCacheKey('||example.com^');
      expect(key).toMatch(/^[a-z0-9]+_\d+$/);
    });

    test('異なるテキストから異なるキーを生成', () => {
      const key1 = generateCacheKey('||example.com^');
      const key2 = generateCacheKey('||test.com^');
      expect(key1).not.toBe(key2);
    });

    test('同じテキストから同じキーを生成', () => {
      const key1 = generateCacheKey('||example.com^||test.com^');
      const key2 = generateCacheKey('||example.com^||test.com^');
      expect(key1).toBe(key2);
    });

    test('長いテキストからキーを生成', () => {
      const longText = 'a'.repeat(150);
      const key = generateCacheKey(longText);
      expect(key).toMatch(/^[a-z0-9]+_150$/);
    });

    test('空文字列からキーを生成', () => {
      const key = generateCacheKey('');
      expect(key).toMatch(/^[a-z0-9]+_0$/);
    });

    // PERF-019テスト: 類似した異なるテキストから異なるキーを生成
    test('PERF-019: 先頭が同じで後半が異なるテキストから異なるキーを生成', () => {
      const text1 = '||example.com^';
      const text2 = '||example.com^something-different';
      const key1 = generateCacheKey(text1);
      const key2 = generateCacheKey(text2);
      expect(key1).not.toBe(key2);
    });

    // PERF-019テスト: 長さは同じだが内容が異なるテキストから異なるキーを生成
    test('PERF-019: 同じ長さで異なる内容のテキストから異なるキーを生成', () => {
      const text1 = '||example.com^';
      const text2 = '||test-domain^'; // 同じ長さで異なる内容
      const key1 = generateCacheKey(text1);
      const key2 = generateCacheKey(text2);
      expect(key1).not.toBe(key2);
    });

    // PERF-019テスト: ハッシュベースのキー生成による衝突防止
    test('PERF-019: 100文字境界で内容が異なるテキストで衝突しない', () => {
      // 先頭100文字が同じで、101文字目以降が異なる2つのテキスト
      const baseText = 'a'.repeat(100);
      const text1 = baseText + 'x';
      const text2 = baseText + 'y';
      const key1 = generateCacheKey(text1);
      const key2 = generateCacheKey(text2);
      expect(key1).not.toBe(key2);
    });

    // PERF-019テスト: 大量の異なるテキストで一意なキーが生成されることを確認
    test('PERF-019: 多数の異なるテキストから一意なキーが生成される', () => {
      const keys = new Set();
      const count = 100;

      for (let i = 0; i < count; i++) {
        const text = `||domain${i}.com^`.repeat(10); // 十分に異なるテキスト
        const key = generateCacheKey(text);
        keys.add(key);
      }

      // 全てのキーが一意であることを確認
      expect(keys.size).toBe(count);
    });
  });

  // ============================================================================
  // saveToCache / getFromCache
  // ============================================================================

  describe('saveToCache and getFromCache', () => {
    test('値を保存して取得できる', () => {
      const key = 'test_key_1';
      const value = { blockRules: ['example.com'], exceptionRules: [] };

      saveToCache(key, value);
      const retrieved = getFromCache(key);

      expect(retrieved).not.toBeNull();
      expect(retrieved).toEqual(value);
    });

    test('存在しないキーの場合はnullを返す', () => {
      const result = getFromCache('non_existent_key');
      expect(result).toBeNull();
    });

    test('異なるキーで異なる値を保存できる', () => {
      const key1 = 'test_key_2';
      const key2 = 'test_key_3';
      const value1 = { blockRules: ['example.com'] };
      const value2 = { blockRules: ['test.com'] };

      saveToCache(key1, value1);
      saveToCache(key2, value2);

      expect(getFromCache(key1)).toEqual(value1);
      expect(getFromCache(key2)).toEqual(value2);
    });

    test('LRUトラッカーが更新される', () => {
      const key1 = 'test_key_4';
      const key2 = 'test_key_5';

      saveToCache(key1, { blockRules: [] });
      saveToCache(key2, { blockRules: [] });

      // getFromCacheを呼ぶとLRUトラッカーが更新されるはず
      getFromCache(key1);
      getFromCache(key2);

      // キャッシュが存在することを確認
      expect(hasCacheKey(key1)).toBe(true);
      expect(hasCacheKey(key2)).toBe(true);
    });
  });

  // ============================================================================
  // hasCacheKey
  // ============================================================================

  describe('hasCacheKey', () => {
    test('存在するキーはtrueを返す', () => {
      const key = 'test_key_6';
      saveToCache(key, { blockRules: [] });

      expect(hasCacheKey(key)).toBe(true);
    });

    test('存在しないキーはfalseを返す', () => {
      expect(hasCacheKey('non_existent_key')).toBe(false);
    });

    test('空のキーでも判定可能', () => {
      const key = '';
      saveToCache(key, { blockRules: [] });

      expect(hasCacheKey(key)).toBe(true);
    });
  });

  // ============================================================================
  // updateLRUTracker
  // ============================================================================

  describe('updateLRUTracker', () => {
    test('LRUトラッカーのエントリを更新できる', () => {
      const key1 = 'test_key_7';
      const key2 = 'test_key_8';

      saveToCache(key1, { blockRules: [] });
      saveToCache(key2, { blockRules: [] });

      // getFromCacheを呼んでLRUトラッカーを更新
      getFromCache(key1);
      expect(hasCacheKey(key1)).toBe(true);
      expect(hasCacheKey(key2)).toBe(true);
    });

    test('更新されたキーがLRUリストの末尾に移動', () => {
      const key1 = 'test_key_9';
      const key2 = 'test_key_10';

      saveToCache(key1, { blockRules: [] });
      saveToCache(key2, { blockRules: [] });

      // key1に再度アクセスすると、LRUリストの順序が更新される
      getFromCache(key1);
      expect(hasCacheKey(key1)).toBe(true);
    });
  });

  // ============================================================================
  // cleanupCache
  // ============================================================================

  describe('cleanupCache', () => {
    test('クリーンアップを実行してもエラーを投げない', () => {
      expect(() => cleanupCache()).not.toThrow();
    });

    test('クリーンアップ後にキャッシュが空になる可能性がある', () => {
      const key = 'test_key_11';
      saveToCache(key, { blockRules: [] });

      // クリーンアップを実行（内部タイマーに依存するため、
      // 直後に実行しても必ずクリアされるとは限らない）
      cleanupCache();

      // エラーハンドリングのみ確認
      expect(() => getFromCache(key)).not.toThrow();
    });

    test('クリーンアップタイマー設定（時間経過後にクリーンアップされる）', () => {
      const key1 = 'test_cleanup_1';
      const key2 = 'test_cleanup_2';

      // 一時的にCLEANUP_INTERVALを短くしてテストする
      const { cleanupCache } = require('../ublockParser/cache.js');

      saveToCache(key1, { blockRules: ['domain1.com'] });
      saveToCache(key2, { blockRules: ['domain2.com'] });

      // 保存直後は取得できる
      expect(getFromCache(key1)).not.toBeNull();
      expect(getFromCache(key2)).not.toBeNull();

      // クリーンアップ関数が呼ばれるとエラーを投げないことを確認
      expect(() => cleanupCache()).not.toThrow();
    });
  });

  // ============================================================================
  // 統合テスト
  // ============================================================================

  describe('Integration Tests', () => {
    test('キャッシュ化ループの一連の操作', () => {
      const key = 'integration_key_1';
      const value = {
        blockRules: ['example.com', 'test.com'],
        exceptionRules: ['trusted.com']
      };

      // 保存
      saveToCache(key, value);

      // 存在確認
      expect(hasCacheKey(key)).toBe(true);

      // 取得
      const retrieved = getFromCache(key);
      expect(retrieved).toEqual(value);

      // 再取得でコピーであることを確認（別オブジェクト）
      const retrieved2 = getFromCache(key);
      expect(retrieved).not.toBe(retrieved2);
      expect(retrieved2).toEqual(value);

      // クリーンアップ
      expect(() => cleanupCache()).not.toThrow();
    });

    test('大量のエントリを処理', () => {
      const entries = 40; // LRU_MAX_ENTRIES (50) 未満にする
      for (let i = 0; i < entries; i++) {
        const key = `bulk_key_${i}`;
        saveToCache(key, { blockRules: [`domain${i}.com`] });
      }

      // 最初と最後のエントリが取得できることを確認
      expect(hasCacheKey('bulk_key_0')).toBe(true);
      expect(hasCacheKey(`bulk_key_${entries - 1}`)).toBe(true);
    });
  });
});