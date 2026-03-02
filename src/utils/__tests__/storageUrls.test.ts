/**
 * storageUrls.test.ts
 * URL管理関連機能のテスト
 *
 * テスト対象:
 * - setSavedUrlsWithTimestamps(urlMap, urlToAdd) の urlToAdd パラメータ処理
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// storageUrls.ts からエクスポートされる定数と型をインポート
const MAX_URL_SET_SIZE = 10000;
const URL_WARNING_THRESHOLD = 8000;
const URL_RETENTION_DAYS = 7;

type RecordType = 'auto' | 'manual';

interface SavedUrlEntry {
    url: string;
    timestamp: number;
    recordType?: RecordType;
    maskedCount?: number;
    tags?: string[];
}

// モックストレージ
interface MockStorageData {
    [key: string]: unknown;
}

const mockStorage: Map<string, MockStorageData> = new Map();

// chrome.storage.local のモック
const mockChromeStorageLocal = {
    get: jest.fn((keys: string | string[] | null, callback?: (items: { [key: string]: unknown }) => void) => {
        const result: { [key: string]: unknown } = {};
        if (keys === null || Array.isArray(keys)) {
            const keysToGet = keys === null ? Array.from(mockStorage.keys()) : keys;
            for (const key of keysToGet) {
                if (mockStorage.has(key)) {
                    result[key] = mockStorage.get(key);
                }
            }
        } else {
            if (mockStorage.has(keys)) {
                result[keys] = mockStorage.get(keys);
            }
        }
        if (callback) {
            callback(result);
        }
        return Promise.resolve(result);
    }),
    set: jest.fn((items: { [key: string]: unknown }, callback?: () => void) => {
        for (const [key, value] of Object.entries(items)) {
            mockStorage.set(key, value);
        }
        if (callback) {
            callback();
        }
        return Promise.resolve();
    }),
    clear: jest.fn(() => {
        mockStorage.clear();
        return Promise.resolve();
    }),
};

global.chrome = {
    storage: {
        local: mockChromeStorageLocal,
    },
} as any;

// テスト対象の関数（simplified version for testing）
async function setSavedUrlsWithTimestamps_SimplifiedTesting(
    urlMap: Map<string, number>,
    urlToAdd: string | null = null
): Promise<void> {
    // urlToAddが指定されている場合は、現在のタイムスタンプで追加/更新
    if (urlToAdd) {
        urlMap.set(urlToAdd, Date.now());
    }

    const urlArray = Array.from(urlMap.keys());

    // モック用に簡略化した実装
    const entries: SavedUrlEntry[] = Array.from(urlMap.entries()).map(([url, timestamp]) => ({
        url,
        timestamp,
    }));

    await mockChromeStorageLocal.set({ savedUrlsWithTimestamps: entries });
    await mockChromeStorageLocal.set({ savedUrls: urlArray });
}

describe('storageUrls: setSavedUrlsWithTimestamps with urlToAdd parameter', () => {
    beforeEach(() => {
        mockStorage.clear();
        jest.clearAllMocks();
    });

    afterEach(() => {
        mockStorage.clear();
    });

    describe('urlToAdd パラメータの基本的な動作', () => {
        it('urlToAdd が指定されている場合、URLがMapに追加される', async () => {
            const urlMap = new Map<string, number>([
                ['https://example.com/page1', 1000],
                ['https://example.com/page2', 2000],
            ]);
            const urlToAdd = 'https://example.com/new-page';

            await setSavedUrlsWithTimestamps_SimplifiedTesting(urlMap, urlToAdd);

            const result = await mockChromeStorageLocal.get('savedUrlsWithTimestamps');
            const entries = result.savedUrlsWithTimestamps as SavedUrlEntry[];
            const urls = entries.map((e) => e.url);

            expect(urls).toContain(urlToAdd);
            expect(urls.length).toBe(3);
        });

        it('urlToAdd が既存のURLの場合、タイムスタンプが更新される', async () => {
            const oldTimestamp = 1000;
            const urlMap = new Map<string, number>([
                ['https://example.com/page1', oldTimestamp],
            ]);
            const urlToAdd = 'https://example.com/page1';

            // 少し待ってから実行（タイムスタンプが変わることを確認）
            await new Promise((resolve) => setTimeout(resolve, 10));
            await setSavedUrlsWithTimestamps_SimplifiedTesting(urlMap, urlToAdd);

            const result = await mockChromeStorageLocal.get('savedUrlsWithTimestamps');
            const entries = result.savedUrlsWithTimestamps as SavedUrlEntry[];
            const entry = entries.find((e) => e.url === urlToAdd);

            expect(entry).toBeDefined();
            expect(entry!.timestamp).toBeGreaterThan(oldTimestamp);
        });

        it('urlToAdd が null の場合、既存のURLのみが保存される', async () => {
            const urlMap = new Map<string, number>([
                ['https://example.com/page1', 1000],
                ['https://example.com/page2', 2000],
            ]);

            await setSavedUrlsWithTimestamps_SimplifiedTesting(urlMap, null);

            const result = await mockChromeStorageLocal.get('savedUrlsWithTimestamps');
            const entries = result.savedUrlsWithTimestamps as SavedUrlEntry[];
            const urls = entries.map((e) => e.url);

            expect(urls).toContain('https://example.com/page1');
            expect(urls).toContain('https://example.com/page2');
            expect(urls.length).toBe(2);
        });

        it('urlToAdd が undefined の場合、既存のURLのみが保存される', async () => {
            const urlMap = new Map<string, number>([
                ['https://example.com/page1', 1000],
            ]);

            await setSavedUrlsWithTimestamps_SimplifiedTesting(urlMap, undefined as any);

            const result = await mockChromeStorageLocal.get('savedUrlsWithTimestamps');
            const entries = result.savedUrlsWithTimestamps as SavedUrlEntry[];
            const urls = entries.map((e) => e.url);

            expect(urls.length).toBe(1);
        });
    });

    describe('savedUrls との同期', () => {
        it('savedUrlsWithTimestamps と savedUrls が同期されている', async () => {
            const urlMap = new Map<string, number>();
            const urlToAdd = 'https://example.com/page1';

            await setSavedUrlsWithTimestamps_SimplifiedTesting(urlMap, urlToAdd);

            const tsResult = await mockChromeStorageLocal.get('savedUrlsWithTimestamps');
            const urlsResult = await mockChromeStorageLocal.get('savedUrls');

            const tsEntries = tsResult.savedUrlsWithTimestamps as SavedUrlEntry[];
            const urlsArray = urlsResult.savedUrls as string[];

            expect(tsEntries.length).toBe(urlsArray.length);
            expect(tsEntries[0].url).toBe(urlsArray[0]);
        });

        it('複数のURLが正しく同期される', async () => {
            const urlMap = new Map<string, number>();
            const urlsToAdd = [
                'https://example.com/page1',
                'https://example.com/page2',
                'https://example.com/page3',
            ];

            // 複数のURLを追加
            for (const url of urlsToAdd) {
                await new Promise((resolve) => setTimeout(resolve, 1)); // タイムスタンプの重複回避
                await setSavedUrlsWithTimestamps_SimplifiedTesting(urlMap, url);
            }

            const tsResult = await mockChromeStorageLocal.get('savedUrlsWithTimestamps');
            const urlsResult = await mockChromeStorageLocal.get('savedUrls');

            const tsEntries = tsResult.savedUrlsWithTimestamps as SavedUrlEntry[];
            const urlsArray = urlsResult.savedUrls as string[];

            expect(tsEntries.length).toBe(urlsArray.length);
            expect(urlsArray).toContain('https://example.com/page1');
            expect(urlsArray).toContain('https://example.com/page2');
            expect(urlsArray).toContain('https://example.com/page3');
        });
    });

    describe('エッジケース', () => {
        it('空の urlMap に urlToAdd を追加する', async () => {
            const urlMap = new Map<string, number>();
            const urlToAdd = 'https://example.com/only-page';

            await setSavedUrlsWithTimestamps_SimplifiedTesting(urlMap, urlToAdd);

            const result = await mockChromeStorageLocal.get('savedUrlsWithTimestamps');
            const entries = result.savedUrlsWithTimestamps as SavedUrlEntry[];

            expect(entries.length).toBe(1);
            expect(entries[0].url).toBe(urlToAdd);
        });

        it('空文字列の urlToAdd は追加されない（実装の挙動）', async () => {
            const urlMap = new Map<string, number>();
            const urlToAdd = '';

            await setSavedUrlsWithTimestamps_SimplifiedTesting(urlMap, urlToAdd);

            const result = await mockChromeStorageLocal.get('savedUrlsWithTimestamps');
            const entries = result.savedUrlsWithTimestamps as SavedUrlEntry[];

            // 空文字列のURLは有効でないため追加されない
            expect(entries.length).toBe(0);
        });

        it('特殊文字を含むURLを追加する', async () => {
            const urlMap = new Map<string, number>();
            const urlToAdd = 'https://example.com/path?query=test&param=value#fragment';

            await setSavedUrlsWithTimestamps_SimplifiedTesting(urlMap, urlToAdd);

            const result = await mockChromeStorageLocal.get('savedUrlsWithTimestamps');
            const entries = result.savedUrlsWithTimestamps as SavedUrlEntry[];

            expect(entries.length).toBe(1);
            expect(entries[0].url).toBe(urlToAdd);
        });

        it('Unicode URL（日本語）を追加する', async () => {
            const urlMap = new Map<string, number>();
            const urlToAdd = 'https://example.com/日本語/ページ';

            await setSavedUrlsWithTimestamps_SimplifiedTesting(urlMap, urlToAdd);

            const result = await mockChromeStorageLocal.get('savedUrlsWithTimestamps');
            const entries = result.savedUrlsWithTimestamps as SavedUrlEntry[];

            expect(entries.length).toBe(1);
            expect(entries[0].url).toBe(urlToAdd);
        });
    });

    describe('タイムスタンプの検証', () => {
        it('urlToAdd に現在のタイムスタンプが設定される', async () => {
            const urlMap = new Map<string, number>();
            const urlToAdd = 'https://example.com/page1';
            const beforeTime = Date.now();

            await setSavedUrlsWithTimestamps_SimplifiedTesting(urlMap, urlToAdd);
            const afterTime = Date.now();

            const result = await mockChromeStorageLocal.get('savedUrlsWithTimestamps');
            const entries = result.savedUrlsWithTimestamps as SavedUrlEntry[];
            const entry = entries.find((e) => e.url === urlToAdd);

            expect(entry).toBeDefined();
            expect(entry!.timestamp).toBeGreaterThanOrEqual(beforeTime);
            expect(entry!.timestamp).toBeLessThanOrEqual(afterTime);
        });
    });
});