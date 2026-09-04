/**
 * storageUrls-exports.test.ts
 * storageUrls.ts のエクスポート関数テスト
 */

import { webcrypto as crypto } from '@peculiar/webcrypto';
Object.defineProperty(global, 'crypto', { value: crypto });

// chrome API モック
const mockStorage: Record<string, any> = {};
const mockChrome = {
    storage: {
        local: {
            get: vi.fn(async (keys: string | string[] | null) => {
                if (keys === null) return { ...mockStorage };
                if (typeof keys === 'string') return { [keys]: mockStorage[keys] };
                const result: Record<string, any> = {};
                for (const key of keys) {
                    if (key in mockStorage) result[key] = mockStorage[key];
                }
                return result;
            }),
            set: vi.fn(async (data: Record<string, any>) => {
                Object.assign(mockStorage, data);
            })
        }
    }
};
(global as any).chrome = mockChrome;

// optimisticLock モック
vi.mock('../storage/storageTransaction.js', () => ({
    StorageTransaction: class StorageTransaction { withLock = async (_k: string, fn: (v: unknown) => unknown) => fn(undefined); withAtomic = async (_ks: unknown, fn: (vs: unknown) => unknown) => fn([]); },
    withOptimisticLock: vi.fn(async (key: string, fn: (current: any) => any) => {
        const storageKey = key === 'savedUrlsWithTimestamps' ? 'savedUrlsWithTimestamps' : 'settings';
        const current = mockStorage[storageKey] || [];
        const result = fn(current);
        mockStorage[storageKey] = result;
        return result;
    })
}));

// storage モック
vi.mock('../storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

      isDomainInWhitelist: vi.fn((url: string) => url.includes('allowed.com')),
      normalizeUrl: vi.fn((url: string) => url.replace(/\/$/, '').toLowerCase()),
      computeUrlsHash: vi.fn((urls: Set<string>) => Array.from(urls).sort().join('|')),
      Settings: {}

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../storage/defaults.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

      isDomainInWhitelist: vi.fn((url: string) => url.includes('allowed.com')),
      normalizeUrl: vi.fn((url: string) => url.replace(/\/$/, '').toLowerCase()),
      computeUrlsHash: vi.fn((urls: Set<string>) => Array.from(urls).sort().join('|')),
      Settings: {}

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../storage/encryptionSession.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

      isDomainInWhitelist: vi.fn((url: string) => url.includes('allowed.com')),
      normalizeUrl: vi.fn((url: string) => url.replace(/\/$/, '').toLowerCase()),
      computeUrlsHash: vi.fn((urls: Set<string>) => Array.from(urls).sort().join('|')),
      Settings: {}

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../storage.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

      isDomainInWhitelist: vi.fn((url: string) => url.includes('allowed.com')),
      normalizeUrl: vi.fn((url: string) => url.replace(/\/$/, '').toLowerCase()),
      computeUrlsHash: vi.fn((urls: Set<string>) => Array.from(urls).sort().join('|')),
      Settings: {}

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../storage/savedUrlRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

      isDomainInWhitelist: vi.fn((url: string) => url.includes('allowed.com')),
      normalizeUrl: vi.fn((url: string) => url.replace(/\/$/, '').toLowerCase()),
      computeUrlsHash: vi.fn((urls: Set<string>) => Array.from(urls).sort().join('|')),
      Settings: {}

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../storage/domainFilterCache.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

      isDomainInWhitelist: vi.fn((url: string) => url.includes('allowed.com')),
      normalizeUrl: vi.fn((url: string) => url.replace(/\/$/, '').toLowerCase()),
      computeUrlsHash: vi.fn((urls: Set<string>) => Array.from(urls).sort().join('|')),
      Settings: {}

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../storage/quota.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

      isDomainInWhitelist: vi.fn((url: string) => url.includes('allowed.com')),
      normalizeUrl: vi.fn((url: string) => url.replace(/\/$/, '').toLowerCase()),
      computeUrlsHash: vi.fn((urls: Set<string>) => Array.from(urls).sort().join('|')),
      Settings: {}

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;

import {
    MAX_URL_SET_SIZE,
    URL_WARNING_THRESHOLD,
    getSavedUrls,
    getSavedUrlsWithTimestamps,
    addSavedUrl,
    removeSavedUrl,
    isUrlSaved,
    getSavedUrlCount,
    computeUrlsHash,
    updateSavedUrlEntry,
    setUrlTags,
    addUrlTag,
    removeUrlTag
} from '../storageUrls.js';

describe('storageUrls exports', () => {

    beforeEach(() => {
        Object.keys(mockStorage).forEach(key => delete mockStorage[key]);
        vi.clearAllMocks();
    });

    describe('定数', () => {
        test('MAX_URL_SET_SIZE は 10000', () => {
            expect(MAX_URL_SET_SIZE).toBe(10000);
        });

        test('URL_WARNING_THRESHOLD は 8000', () => {
            expect(URL_WARNING_THRESHOLD).toBe(8000);
        });
    });

    describe('getSavedUrls', () => {
        test('空の場合は空Setを返す', async () => {
            const result = await getSavedUrls();
            expect(result).toBeInstanceOf(Set);
            expect(result.size).toBe(0);
        });

        test('保存されたURLをSetで返す', async () => {
            mockStorage['savedUrls'] = ['https://example.com', 'https://test.com'];
            const result = await getSavedUrls();
            expect(result.size).toBe(2);
            expect(result.has('https://example.com')).toBe(true);
        });
    });

    describe('getSavedUrlsWithTimestamps', () => {
        test('空の場合は空Mapを返す', async () => {
            const result = await getSavedUrlsWithTimestamps();
            expect(result).toBeInstanceOf(Map);
            expect(result.size).toBe(0);
        });

        test('保存されたエントリをMapで返す', async () => {
            mockStorage['savedUrlsWithTimestamps'] = [
                { url: 'https://example.com', timestamp: 1000 },
                { url: 'https://test.com', timestamp: 2000 }
            ];
            const result = await getSavedUrlsWithTimestamps();
            expect(result.size).toBe(2);
            expect(result.get('https://example.com')).toBe(1000);
        });
    });

    describe('isUrlSaved', () => {
        test('保存済みURLで true', async () => {
            mockStorage['savedUrls'] = ['https://example.com'];
            const result = await isUrlSaved('https://example.com');
            expect(result).toBe(true);
        });

        test('未保存URLで false', async () => {
            mockStorage['savedUrls'] = ['https://other.com'];
            const result = await isUrlSaved('https://example.com');
            expect(result).toBe(false);
        });
    });

    describe('getSavedUrlCount', () => {
        test('保存数を返す', async () => {
            mockStorage['savedUrls'] = ['a.com', 'b.com', 'c.com'];
            const result = await getSavedUrlCount();
            expect(result).toBe(3);
        });

        test('空の場合は 0', async () => {
            const result = await getSavedUrlCount();
            expect(result).toBe(0);
        });
    });

    describe('computeUrlsHash', () => {
        test('URLセットのハッシュを返す', () => {
            const urls = new Set(['https://a.com', 'https://b.com']);
            const hash = computeUrlsHash(urls);
            expect(typeof hash).toBe('string');
            expect(hash.length).toBeGreaterThan(0);
        });

        test('同じURLセットで同じハッシュ', () => {
            const urls1 = new Set(['https://a.com', 'https://b.com']);
            const urls2 = new Set(['https://b.com', 'https://a.com']);
            expect(computeUrlsHash(urls1)).toBe(computeUrlsHash(urls2));
        });

        test('空セットで空文字', () => {
            const hash = computeUrlsHash(new Set());
            expect(hash).toBe('');
        });
    });

    describe('addUrlTag / removeUrlTag / setUrlTags', () => {
        test('addUrlTag でタグを追加する', async () => {
            mockStorage['savedUrlsWithTimestamps'] = [
                { url: 'https://example.com', timestamp: 1000 }
            ];

            await addUrlTag('https://example.com', 'news');

            const entries = mockStorage['savedUrlsWithTimestamps'];
            expect(entries[0].tags).toContain('news');
        });

        test('addUrlTag で重複タグを追加しない', async () => {
            mockStorage['savedUrlsWithTimestamps'] = [
                { url: 'https://example.com', timestamp: 1000, tags: ['news'] }
            ];

            await addUrlTag('https://example.com', 'news');

            const entries = mockStorage['savedUrlsWithTimestamps'];
            expect(entries[0].tags).toEqual(['news']);
        });

        test('removeUrlTag でタグを削除する', async () => {
            mockStorage['savedUrlsWithTimestamps'] = [
                { url: 'https://example.com', timestamp: 1000, tags: ['news', 'tech'] }
            ];

            await removeUrlTag('https://example.com', 'news');

            const entries = mockStorage['savedUrlsWithTimestamps'];
            expect(entries[0].tags).toEqual(['tech']);
        });

        test('setUrlTags でタグを設定する', async () => {
            mockStorage['savedUrlsWithTimestamps'] = [
                { url: 'https://example.com', timestamp: 1000 }
            ];

            await setUrlTags('https://example.com', ['a', 'b']);

            const entries = mockStorage['savedUrlsWithTimestamps'];
            expect(entries[0].tags).toEqual(['a', 'b']);
        });
    });

    describe('updateSavedUrlEntry メタデータ更新', () => {
        const testUrl = 'https://example.com/page';

        beforeEach(() => {
            mockStorage['savedUrlsWithTimestamps'] = [
                { url: testUrl, timestamp: 1000 }
            ];
        });

        test('updateSavedUrlEntry で aiSummary を設定する', async () => {
            await updateSavedUrlEntry(testUrl, (entry) => ({ ...entry, aiSummary: 'Summary text' }));
            expect(mockStorage['savedUrlsWithTimestamps'][0].aiSummary).toBe('Summary text');
        });

        test('updateSavedUrlEntry で sentTokens を設定する', async () => {
            await updateSavedUrlEntry(testUrl, (entry) => ({ ...entry, sentTokens: 150 }));
            expect(mockStorage['savedUrlsWithTimestamps'][0].sentTokens).toBe(150);
        });

        test('updateSavedUrlEntry で receivedTokens を設定する', async () => {
            await updateSavedUrlEntry(testUrl, (entry) => ({ ...entry, receivedTokens: 300 }));
            expect(mockStorage['savedUrlsWithTimestamps'][0].receivedTokens).toBe(300);
        });

        test('updateSavedUrlEntry で originalTokens を設定する', async () => {
            await updateSavedUrlEntry(testUrl, (entry) => ({ ...entry, originalTokens: 500 }));
            expect(mockStorage['savedUrlsWithTimestamps'][0].originalTokens).toBe(500);
        });

        test('updateSavedUrlEntry で cleansedTokens を設定する', async () => {
            await updateSavedUrlEntry(testUrl, (entry) => ({ ...entry, cleansedTokens: 200 }));
            expect(mockStorage['savedUrlsWithTimestamps'][0].cleansedTokens).toBe(200);
        });

        test('updateSavedUrlEntry で pageBytes を設定する', async () => {
            await updateSavedUrlEntry(testUrl, (entry) => ({ ...entry, pageBytes: 10240 }));
            expect(mockStorage['savedUrlsWithTimestamps'][0].pageBytes).toBe(10240);
        });

        test('updateSavedUrlEntry で candidateBytes を設定する', async () => {
            await updateSavedUrlEntry(testUrl, (entry) => ({ ...entry, candidateBytes: 8192 }));
            expect(mockStorage['savedUrlsWithTimestamps'][0].candidateBytes).toBe(8192);
        });

        test('updateSavedUrlEntry で originalBytes を設定する', async () => {
            await updateSavedUrlEntry(testUrl, (entry) => ({ ...entry, originalBytes: 4096 }));
            expect(mockStorage['savedUrlsWithTimestamps'][0].originalBytes).toBe(4096);
        });

        test('updateSavedUrlEntry で cleansedBytes を設定する', async () => {
            await updateSavedUrlEntry(testUrl, (entry) => ({ ...entry, cleansedBytes: 2048 }));
            expect(mockStorage['savedUrlsWithTimestamps'][0].cleansedBytes).toBe(2048);
        });

        test('updateSavedUrlEntry で content を設定する', async () => {
            await updateSavedUrlEntry(testUrl, (entry) => ({ ...entry, content: 'Page content' }));
            expect(mockStorage['savedUrlsWithTimestamps'][0].content).toBe('Page content');
        });

        test('updateSavedUrlEntry で recordType を設定する', async () => {
            await updateSavedUrlEntry(testUrl, (entry) => ({ ...entry, recordType: 'manual' }));
            expect(mockStorage['savedUrlsWithTimestamps'][0].recordType).toBe('manual');
        });

        test('updateSavedUrlEntry で cleansedReason を設定する', async () => {
            await updateSavedUrlEntry(testUrl, (entry) => ({ ...entry, cleansedReason: 'hard' }));
            expect(mockStorage['savedUrlsWithTimestamps'][0].cleansedReason).toBe('hard');
        });

        test('updateSavedUrlEntry で maskedCount を設定する', async () => {
            await updateSavedUrlEntry(testUrl, (entry) => ({ ...entry, maskedCount: 5 }));
            expect(mockStorage['savedUrlsWithTimestamps'][0].maskedCount).toBe(5);
        });

        test('存在しないURLでは変更しない', async () => {
            await updateSavedUrlEntry('https://nonexistent.com', (entry) => ({ ...entry, aiSummary: 'Summary' }));
            expect(mockStorage['savedUrlsWithTimestamps'][0].aiSummary).toBeUndefined();
        });
    });
});
