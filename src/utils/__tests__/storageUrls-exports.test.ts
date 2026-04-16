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
vi.mock('../optimisticLock.js', () => ({
    withOptimisticLock: vi.fn(async (key: string, fn: (current: any) => any) => {
        const storageKey = key === 'savedUrlsWithTimestamps' ? 'savedUrlsWithTimestamps' : 'settings';
        const current = mockStorage[storageKey] || [];
        const result = fn(current);
        mockStorage[storageKey] = result;
        return result;
    })
}));

// storage モック
vi.mock('../storage.js', () => ({
    isDomainInWhitelist: vi.fn((url: string) => url.includes('allowed.com')),
    normalizeUrl: vi.fn((url: string) => url.replace(/\/$/, '').toLowerCase()),
    computeUrlsHash: vi.fn((urls: Set<string>) => Array.from(urls).sort().join('|')),
    Settings: {}
}));

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
    setUrlTags,
    addUrlTag,
    removeUrlTag,
    setUrlAiSummary,
    setUrlSentTokens,
    setUrlReceivedTokens,
    setUrlOriginalTokens,
    setUrlCleansedTokens,
    setUrlPageBytes,
    setUrlCandidateBytes,
    setUrlOriginalBytes,
    setUrlCleansedBytes,
    setUrlContent,
    setUrlRecordType,
    setUrlCleansedReason,
    setUrlMaskedCount
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

    describe('setUrl* メタデータ関数群', () => {
        const testUrl = 'https://example.com/page';

        beforeEach(() => {
            mockStorage['savedUrlsWithTimestamps'] = [
                { url: testUrl, timestamp: 1000 }
            ];
        });

        test('setUrlAiSummary', async () => {
            await setUrlAiSummary(testUrl, 'Summary text');
            expect(mockStorage['savedUrlsWithTimestamps'][0].aiSummary).toBe('Summary text');
        });

        test('setUrlSentTokens', async () => {
            await setUrlSentTokens(testUrl, 150);
            expect(mockStorage['savedUrlsWithTimestamps'][0].sentTokens).toBe(150);
        });

        test('setUrlReceivedTokens', async () => {
            await setUrlReceivedTokens(testUrl, 300);
            expect(mockStorage['savedUrlsWithTimestamps'][0].receivedTokens).toBe(300);
        });

        test('setUrlOriginalTokens', async () => {
            await setUrlOriginalTokens(testUrl, 500);
            expect(mockStorage['savedUrlsWithTimestamps'][0].originalTokens).toBe(500);
        });

        test('setUrlCleansedTokens', async () => {
            await setUrlCleansedTokens(testUrl, 200);
            expect(mockStorage['savedUrlsWithTimestamps'][0].cleansedTokens).toBe(200);
        });

        test('setUrlPageBytes', async () => {
            await setUrlPageBytes(testUrl, 10240);
            expect(mockStorage['savedUrlsWithTimestamps'][0].pageBytes).toBe(10240);
        });

        test('setUrlCandidateBytes', async () => {
            await setUrlCandidateBytes(testUrl, 8192);
            expect(mockStorage['savedUrlsWithTimestamps'][0].candidateBytes).toBe(8192);
        });

        test('setUrlOriginalBytes', async () => {
            await setUrlOriginalBytes(testUrl, 4096);
            expect(mockStorage['savedUrlsWithTimestamps'][0].originalBytes).toBe(4096);
        });

        test('setUrlCleansedBytes', async () => {
            await setUrlCleansedBytes(testUrl, 2048);
            expect(mockStorage['savedUrlsWithTimestamps'][0].cleansedBytes).toBe(2048);
        });

        test('setUrlContent', async () => {
            await setUrlContent(testUrl, 'Page content');
            expect(mockStorage['savedUrlsWithTimestamps'][0].content).toBe('Page content');
        });

        test('setUrlRecordType', async () => {
            await setUrlRecordType(testUrl, 'manual');
            expect(mockStorage['savedUrlsWithTimestamps'][0].recordType).toBe('manual');
        });

        test('setUrlCleansedReason', async () => {
            await setUrlCleansedReason(testUrl, 'hard');
            expect(mockStorage['savedUrlsWithTimestamps'][0].cleansedReason).toBe('hard');
        });

        test('setUrlMaskedCount', async () => {
            await setUrlMaskedCount(testUrl, 5);
            expect(mockStorage['savedUrlsWithTimestamps'][0].maskedCount).toBe(5);
        });

        test('存在しないURLでは変更しない', async () => {
            await setUrlAiSummary('https://nonexistent.com', 'Summary');
            expect(mockStorage['savedUrlsWithTimestamps'][0].aiSummary).toBeUndefined();
        });
    });
});
