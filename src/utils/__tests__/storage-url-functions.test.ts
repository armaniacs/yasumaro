/**
 * storage-url-functions.test.ts
 * storage.ts の URL管理関数群の直接テスト
 * カバレッジ向上: lines 1087-1249 をカバー
 */

import { jest } from '@jest/globals';

// chrome.storage.local のモック
const mockStorage: Map<string, unknown> = new Map();

const mockChromeStorageLocal = {
  get: jest.fn((keys: string | string[] | null) => {
    const result: Record<string, unknown> = {};
    if (keys === null) {
      for (const [key, value] of mockStorage) {
        result[key] = value;
      }
    } else if (typeof keys === 'string') {
      if (mockStorage.has(keys)) {
        result[keys] = mockStorage.get(keys);
      }
    } else if (Array.isArray(keys)) {
      for (const key of keys) {
        if (mockStorage.has(key)) {
          result[key] = mockStorage.get(key);
        }
      }
    }
    return Promise.resolve(result);
  }),
  set: jest.fn((items: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(items)) {
      mockStorage.set(key, value);
    }
    return Promise.resolve();
  }),
  getBytesInUse: jest.fn(() => Promise.resolve(0)),
};

(global as any).chrome = {
  storage: { local: mockChromeStorageLocal },
} as any;

// optimisticLock をモック（実際の storage 関数のロジックを実行させる）
jest.mock('../optimisticLock.js', () => ({
  withOptimisticLock: jest.fn(async (key: string, fn: (current: any) => any) => {
    const storageKey = key === 'savedUrlsWithTimestamps' ? 'savedUrlsWithTimestamps' : 'savedUrls';
    const current = mockStorage.get(storageKey) || (key === 'savedUrlsWithTimestamps' ? [] : []);
    const result = fn(current);
    mockStorage.set(storageKey, result);
    return result;
  }),
}));

// migration モック
jest.mock('../migration.js', () => ({
  migrateUblockSettings: jest.fn(() => Promise.resolve(false)),
}));

import {
  getSavedUrls,
  getSavedUrlsWithTimestamps,
  setSavedUrls,
  setSavedUrlsWithTimestamps,
  addSavedUrl,
  removeSavedUrl,
  isUrlSaved,
  getSavedUrlCount,
  MAX_URL_SET_SIZE,
  URL_WARNING_THRESHOLD,
} from '../storage.js';

describe('storage.ts URL管理関数', () => {
  beforeEach(() => {
    mockStorage.clear();
    jest.clearAllMocks();
  });

  describe('getSavedUrls', () => {
    it('空の場合は空Setを返す', async () => {
      const result = await getSavedUrls();
      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
    });

    it('保存されたURLをSetで返す', async () => {
      mockStorage.set('savedUrls', ['https://example.com', 'https://test.com']);
      const result = await getSavedUrls();
      expect(result.size).toBe(2);
      expect(result.has('https://example.com')).toBe(true);
      expect(result.has('https://test.com')).toBe(true);
    });
  });

  describe('getSavedUrlsWithTimestamps', () => {
    it('空の場合は空Mapを返す', async () => {
      const result = await getSavedUrlsWithTimestamps();
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    it('保存されたエントリをMapで返す', async () => {
      mockStorage.set('savedUrlsWithTimestamps', [
        { url: 'https://example.com', timestamp: 1000 },
        { url: 'https://test.com', timestamp: 2000 },
      ]);
      const result = await getSavedUrlsWithTimestamps();
      expect(result.size).toBe(2);
      expect(result.get('https://example.com')).toBe(1000);
      expect(result.get('https://test.com')).toBe(2000);
    });
  });

  describe('setSavedUrls', () => {
    it('URLセットを保存する', async () => {
      const urlSet = new Set(['https://example.com', 'https://test.com']);
      await setSavedUrls(urlSet);

      const saved = mockStorage.get('savedUrls') as string[];
      expect(saved).toContain('https://example.com');
      expect(saved).toContain('https://test.com');
    });

    it('urlToAdd が指定された場合はタイムスタンプを更新する', async () => {
      mockStorage.set('savedUrlsWithTimestamps', [
        { url: 'https://example.com', timestamp: 1000 },
      ]);

      const urlSet = new Set(['https://example.com']);
      await setSavedUrls(urlSet, 'https://example.com');

      const entries = mockStorage.get('savedUrlsWithTimestamps') as any[];
      const entry = entries.find((e: any) => e.url === 'https://example.com');
      expect(entry).toBeDefined();
      expect(entry.timestamp).toBeGreaterThan(1000);
    });
  });

  describe('setSavedUrlsWithTimestamps', () => {
    it('URL Map を保存する', async () => {
      const urlMap = new Map([
        ['https://example.com', 1000],
        ['https://test.com', 2000],
      ]);
      await setSavedUrlsWithTimestamps(urlMap);

      const entries = mockStorage.get('savedUrlsWithTimestamps') as any[];
      expect(entries.length).toBe(2);
    });

    it('urlToAdd で URLを追加する', async () => {
      const urlMap = new Map([['https://existing.com', 1000]]);
      await setSavedUrlsWithTimestamps(urlMap, 'https://new.com');

      const entries = mockStorage.get('savedUrlsWithTimestamps') as any[];
      const newEntry = entries.find((e: any) => e.url === 'https://new.com');
      expect(newEntry).toBeDefined();
    });

    it('既存エントリの recordType を保持する', async () => {
      mockStorage.set('savedUrlsWithTimestamps', [
        { url: 'https://example.com', timestamp: 1000, recordType: 'manual' },
      ]);

      const urlMap = new Map([['https://example.com', 2000]]);
      await setSavedUrlsWithTimestamps(urlMap);

      const entries = mockStorage.get('savedUrlsWithTimestamps') as any[];
      const entry = entries.find((e: any) => e.url === 'https://example.com');
      expect(entry.recordType).toBe('manual');
      expect(entry.timestamp).toBe(2000);
    });
  });

  describe('addSavedUrl', () => {
    it('URLを追加する', async () => {
      await addSavedUrl('https://example.com');

      const entries = mockStorage.get('savedUrlsWithTimestamps') as any[];
      expect(entries.length).toBe(1);
      expect(entries[0].url).toBe('https://example.com');
    });
  });

  describe('removeSavedUrl', () => {
    it('URLを削除する', async () => {
      mockStorage.set('savedUrls', ['https://example.com', 'https://test.com']);
      mockStorage.set('savedUrlsWithTimestamps', [
        { url: 'https://example.com', timestamp: 1000 },
        { url: 'https://test.com', timestamp: 2000 },
      ]);

      await removeSavedUrl('https://example.com');

      const urls = mockStorage.get('savedUrls') as string[];
      expect(urls).not.toContain('https://example.com');
      expect(urls).toContain('https://test.com');

      const entries = mockStorage.get('savedUrlsWithTimestamps') as any[];
      expect(entries.find((e: any) => e.url === 'https://example.com')).toBeUndefined();
    });
  });

  describe('isUrlSaved', () => {
    it('保存済みURLで true を返す', async () => {
      mockStorage.set('savedUrls', ['https://example.com']);
      const result = await isUrlSaved('https://example.com');
      expect(result).toBe(true);
    });

    it('未保存URLで false を返す', async () => {
      mockStorage.set('savedUrls', ['https://other.com']);
      const result = await isUrlSaved('https://example.com');
      expect(result).toBe(false);
    });
  });

  describe('getSavedUrlCount', () => {
    it('保存数を返す', async () => {
      mockStorage.set('savedUrls', ['a.com', 'b.com', 'c.com']);
      const result = await getSavedUrlCount();
      expect(result).toBe(3);
    });

    it('空の場合は 0 を返す', async () => {
      const result = await getSavedUrlCount();
      expect(result).toBe(0);
    });
  });

  describe('定数', () => {
    it('MAX_URL_SET_SIZE は 10000', () => {
      expect(MAX_URL_SET_SIZE).toBe(10000);
    });

    it('URL_WARNING_THRESHOLD は 8000', () => {
      expect(URL_WARNING_THRESHOLD).toBe(8000);
    });
  });
});
