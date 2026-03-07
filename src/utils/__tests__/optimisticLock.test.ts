/**
 * optimisticLock.test.ts
 * Unit tests for optimistic locking module
 */

import {
    withOptimisticLock,
    getConflictStats,
    resetConflictStats,
    ConflictError
} from '../optimisticLock.js';

describe('withOptimisticLock', () => {
    describe('基本機能', () => {
        beforeEach(async () => {
            // Clear storage and stats before each test
            await chrome.storage.local.set({});
            resetConflictStats();
        });

        it('新しい値を更新して返す', async () => {
            await chrome.storage.local.set({ testKey: ['initial'] });

            const result = await withOptimisticLock('testKey', (current) => {
                return [...current, 'item'];
            });

            expect(result).toEqual(['initial', 'item']);
            const stored = await chrome.storage.local.get('testKey');
            expect(stored.testKey).toEqual(['initial', 'item']);
        });

        it('未定義の値に対しても動作する', async () => {
            const result = await withOptimisticLock('testKey', (_current) => {
                return ['new'];
            });

            expect(result).toEqual(['new']);
            const stored = await chrome.storage.local.get('testKey');
            expect(stored.testKey).toEqual(['new']);
        });

        it('複数の更新を連続して実行できる', async () => {
            await chrome.storage.local.set({ testKey: [1] });

            const result1 = await withOptimisticLock('testKey', (current) => {
                return [...current, 2];
            });

            const result2 = await withOptimisticLock('testKey', (current) => {
                return [...current, 3];
            });

            expect(result1).toEqual([1, 2]);
            expect(result2).toEqual([1, 2, 3]);
        });
    });

    describe('並行アクセス', () => {
        beforeEach(async () => {
            await chrome.storage.local.set({});
            resetConflictStats();
        });

        it('並行した複数の操作でデータが破損しない', async () => {
            await chrome.storage.local.set({ testKey: ['initial'] });

            // 並行実行
            const promise1 = withOptimisticLock('testKey', (current) => {
                return [...current, 'item1'];
            });

            const promise2 = withOptimisticLock('testKey', (current) => {
                return [...current, 'item2'];
            });

            await Promise.all([promise1, promise2]);

            const stored = await chrome.storage.local.get('testKey');
            // initialは常に含まれるはず
            expect(stored.testKey).toContain('initial');
            // 少なくとも1つのアイテムが追加されていること
            expect(stored.testKey.length).toBeGreaterThan(1);
        });
    });

    describe('競合検出', () => {
        beforeEach(async () => {
            await chrome.storage.local.set({});
            resetConflictStats();
        });

        it('ConflictErrorが正しくスローされる', async () => {
            await chrome.storage.local.set({ testKey: ['initial'] });

            // chrome.storage.local.getをモックして競合をシミュレート
            // 1回目の呼び出しではtestKeyとtestKey_versionを返し、2回目では異なるバージョンを返す
            const originalGet = chrome.storage.local.get;
            let callCount = 0;
            chrome.storage.local.get = jest.fn(async (keys: string[] | string | string[]) => {
                callCount++;
                if (callCount === 1) {
                    // 最初のget: testKeyと直前のバージョンを返す
                    return { testKey: ['initial'], testKey_version: 0 };
                } else if (callCount === 2) {
                    // 2回目のget: バージョンが変わったことを返す（競合シミュレーション）
                    return { testKey: ['modified'], testKey_version: 10 };
                }
                return originalGet.call(chrome.storage.local, keys);
            });

            await expect(
                withOptimisticLock('testKey', (current) => [...current, 'item'])
            ).rejects.toThrow(ConflictError);

            // 元のgetを復元
            chrome.storage.local.get = originalGet;
            callCount = 0;
        });

        it('ConflictErrorに正しいプロパティが設定される', async () => {
            await chrome.storage.local.set({ testKey: ['initial'] });

            // chrome.storage.local.getをモックして競合をシミュレート
            const originalGet = chrome.storage.local.get;
            let callCount = 0;
            chrome.storage.local.get = jest.fn(async (keys: string[] | string | string[]) => {
                callCount++;
                if (callCount === 1) {
                    return { testKey: ['initial'], testKey_version: 0 };
                } else if (callCount === 2) {
                    return { testKey: ['modified'], testKey_version: 10 };
                }
                return originalGet.call(chrome.storage.local, keys);
            });

            try {
                await withOptimisticLock('testKey', (current) => [...current, 'item']);
                fail('Expected ConflictError to be thrown');
            } catch (error) {
                expect(error).toBeInstanceOf(ConflictError);
                const conflictError = error as ConflictError;
                expect(conflictError.name).toBe('ConflictError');
                expect(conflictError.key).toBe('testKey');
                expect(conflictError.expectedVersion).toBe(0);
                expect(conflictError.actualVersion).toBe(10);
            }

            // 元のgetを復元
            chrome.storage.local.get = originalGet;
            callCount = 0;
        });

        it('競合が統計に記録される', async () => {
            await chrome.storage.local.set({ testKey: ['initial'] });

            // chrome.storage.local.getをモックして競合をシミュレート
            const originalGet = chrome.storage.local.get;
            let callCount = 0;
            chrome.storage.local.get = jest.fn(async (keys: string[] | string | string[]) => {
                callCount++;
                if (callCount === 1) {
                    return { testKey: ['initial'], testKey_version: 0 };
                } else if (callCount === 2) {
                    return { testKey: ['modified'], testKey_version: 10 };
                }
                return originalGet.call(chrome.storage.local, keys);
            });

            try {
                await withOptimisticLock('testKey', (current) => [...current, 'item']);
            } catch (error) {
                // Expected ConflictError
            }

            const stats = getConflictStats();
            expect(stats.totalAttempts).toBe(1);
            expect(stats.totalConflicts).toBe(1);

            // 元のgetを復元
            chrome.storage.local.get = originalGet;
            callCount = 0;
        });
    });

    describe('エラーハンドリング', () => {
        beforeEach(async () => {
            await chrome.storage.local.set({});
            resetConflictStats();
        });

        it('updateFnでスローされたエラーを伝播する', async () => {
            await chrome.storage.local.set({ testKey: ['initial'] });

            await expect(
                withOptimisticLock('testKey', () => {
                    throw new Error('Update function error');
                })
            ).rejects.toThrow('Update function error');

            // 失敗してもstatは記録される
            const stats = getConflictStats();
            expect(stats.totalAttempts).toBe(1);
            expect(stats.totalFailures).toBe(1);
        });

        it('chrome.storage.local.setが失敗した場合にエラーを伝播する', async () => {
            const originalSet = chrome.storage.local.set;
            chrome.storage.local.set = jest.fn(() => Promise.reject(new Error('Storage error')));

            await expect(
                withOptimisticLock('testKey', (current) => current)
            ).rejects.toThrow('Storage error');

            chrome.storage.local.set = originalSet;
        });
    });
});

describe('getConflictStats', () => {
    beforeEach(async () => {
        await chrome.storage.local.set({});
        resetConflictStats();
    });

    it('初期統計を返す', () => {
        const stats = getConflictStats();

        expect(stats).toEqual({
            totalAttempts: 0,
            totalConflicts: 0,
            totalFailures: 0
        });
    });

    it('統計情報をコピーで返す（変更不可）', () => {
        const stats1 = getConflictStats();
        stats1.totalAttempts = 999;

        const stats2 = getConflictStats();
        expect(stats2.totalAttempts).toBe(0);
    });
});

describe('resetConflictStats', () => {
    beforeEach(async () => {
        await chrome.storage.local.set({});
    });

    it('統計情報をリセットする', async () => {
        await chrome.storage.local.set({ testKey: ['initial'] });

        await withOptimisticLock<string[]>('testKey', (current) => [...current, 'item']);

        resetConflictStats();

        const stats = getConflictStats();
        expect(stats.totalAttempts).toBe(0);
        expect(stats.totalConflicts).toBe(0);
        expect(stats.totalFailures).toBe(0);
    });
});

describe('URLセット用のユースケース', () => {
    beforeEach(async () => {
        await chrome.storage.local.set({});
    });

    it('URLを追加するユースケース', async () => {
        await chrome.storage.local.set({ savedUrls: ['https://example.com'] });

        const newUrl = 'https://new-website.com';
        await withOptimisticLock<string[]>('savedUrls', (current) => {
            const urlSet = new Set(current || []);
            urlSet.add(newUrl);
            return Array.from(urlSet);
        });

        const stored = await chrome.storage.local.get('savedUrls');
        expect(stored.savedUrls).toContain(newUrl);
        expect(stored.savedUrls).toContain('https://example.com');
    });

    it('URLを削除するユースケース', async () => {
        await chrome.storage.local.set({
            savedUrls: ['https://example.com', 'https://to-remove.com']
        });

        const urlToRemove = 'https://to-remove.com';
        await withOptimisticLock<string[]>('savedUrls', (current) => {
            const urlSet = new Set(current || []);
            urlSet.delete(urlToRemove);
            return Array.from(urlSet);
        });

        const stored = await chrome.storage.local.get('savedUrls');
        expect(stored.savedUrls).not.toContain(urlToRemove);
        expect(stored.savedUrls).toContain('https://example.com');
    });

    it('最大値制限でLRU削除するユースケース', async () => {
        type UrlEntry = { url: string; timestamp: number };
        await chrome.storage.local.set({
            savedUrlsWithTimestamps: [
                { url: 'https://old.com', timestamp: 1000 },
                { url: 'https://new.com', timestamp: 2000 }
            ]
        });

        await withOptimisticLock<UrlEntry[]>('savedUrlsWithTimestamps', (current) => {
            const entries = current || [];
            return entries.filter((entry) => entry.timestamp > 1500);
        });

        const stored = await chrome.storage.local.get('savedUrlsWithTimestamps');
        const urls = stored.savedUrlsWithTimestamps as UrlEntry[];
        expect(urls).toHaveLength(1);
        expect(urls[0].url).toBe('https://new.com');
    });
});
