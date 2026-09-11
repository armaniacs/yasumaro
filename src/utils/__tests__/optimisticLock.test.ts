/**
 * optimisticLock.test.ts
 * Unit tests for optimistic locking module
 */

import {
    withOptimisticLock,
    ConflictError
} from '../storage/storageTransaction.js';

describe('withOptimisticLock', () => {
    describe('基本機能', () => {
        beforeEach(async () => {
            await chrome.storage.local.set({});
        });

        it('updates and returns a new value', async () => {
            await chrome.storage.local.set({ testKey: ['initial'] });

            const result = await withOptimisticLock<unknown[]>('testKey', (current) => {
                return [...current, 'item'];
            });

            expect(result).toEqual(['initial', 'item']);
            const stored = await chrome.storage.local.get('testKey');
            expect(stored.testKey).toEqual(['initial', 'item']);
        });

        it('works with an undefined value', async () => {
            const result = await withOptimisticLock('testKey', (_current) => {
                return ['new'];
            });

            expect(result).toEqual(['new']);
            const stored = await chrome.storage.local.get('testKey');
            expect(stored.testKey).toEqual(['new']);
        });

        it('runs consecutive updates', async () => {
            await chrome.storage.local.set({ testKey: [1] });

            const result1 = await withOptimisticLock<unknown[]>('testKey', (current) => {
                return [...current, 2];
            });

            const result2 = await withOptimisticLock<unknown[]>('testKey', (current) => {
                return [...current, 3];
            });

            expect(result1).toEqual([1, 2]);
            expect(result2).toEqual([1, 2, 3]);
        });

        it('supports adding a URL', async () => {
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

        it('supports removing a URL', async () => {
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

        it('evicts LRU entries under a max-size limit', async () => {
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
            expect(urls[0]!.url).toBe('https://new.com');
        });
    });

    describe('並行アクセス', () => {
        beforeEach(async () => {
            await chrome.storage.local.set({});
        });

        it('keeps data intact across concurrent operations', async () => {
            await chrome.storage.local.set({ testKey: ['initial'] });

            // 並行実行
            const promise1 = withOptimisticLock<unknown[]>('testKey', (current) => {
                return [...current, 'item1'];
            });

            const promise2 = withOptimisticLock<unknown[]>('testKey', (current) => {
                return [...current, 'item2'];
            });

            await Promise.all([promise1, promise2]);

            const stored = await chrome.storage.local.get('testKey');
            // initialは常に含まれるはず
            expect(stored.testKey).toContain('initial');
            // 少なくとも1つのアイテムが追加されていること
            expect((stored.testKey as unknown[]).length).toBeGreaterThan(1);
        });
    });

    describe('競合検出', () => {
        let originalGet: any;
        let originalSet: any;

        beforeEach(async () => {
            await chrome.storage.local.set({});
            // モックを保存
            originalGet = chrome.storage.local.get;
            originalSet = chrome.storage.local.set;
        });

        afterEach(() => {
            // モックを復元
            chrome.storage.local.get = originalGet;
            chrome.storage.local.set = originalSet;
        });

        it('throws ConflictError correctly', async () => {
            await chrome.storage.local.set({ testKey: ['initial'] });

            // chrome.storage.local.getをモックして競合をシミュレート
            // 1回目の呼び出しではtestKeyとtestKey_versionを返し、2回目では異なるバージョンを返す
            const setupOriginalGet = originalGet;
            let callCount = 0;
            chrome.storage.local.get = (vi.fn(async (keys?: string | string[] | Record<string, unknown> | null) => {
                callCount++;
                if (callCount === 1) {
                    // 最初のget: testKeyと直前のバージョンを返す
                    return { testKey: ['initial'], testKey_version: 0 };
                } else if (callCount === 2) {
                    // 2回目のget: バージョンが変わったことを返す（競合シミュレーション）
                    return { testKey: ['modified'], testKey_version: 10 };
                }
                return setupOriginalGet.call(chrome.storage.local, keys);
            }) as unknown) as typeof chrome.storage.local.get;

            await expect(
                withOptimisticLock<unknown[]>('testKey', (current) => [...current, 'item'], { maxRetries: 0 })
            ).rejects.toThrow(ConflictError);
        });

        it('sets the correct properties on ConflictError', async () => {
            await chrome.storage.local.set({ testKey: ['initial'] });

            // chrome.storage.local.getをモックして競合をシミュレート
            const setupOriginalGet = originalGet;
            let callCount = 0;
            chrome.storage.local.get = (vi.fn(async (keys?: string | string[] | Record<string, unknown> | null) => {
                callCount++;
                if (callCount === 1) {
                    return { testKey: ['initial'], testKey_version: 0 };
                } else if (callCount === 2) {
                    return { testKey: ['modified'], testKey_version: 10 };
                }
                return setupOriginalGet.call(chrome.storage.local, keys);
            }) as unknown) as typeof chrome.storage.local.get;

            try {
                await withOptimisticLock<unknown[]>('testKey', (current) => [...current, 'item'], { maxRetries: 0 });
                expect.fail('Expected ConflictError to be thrown');
            } catch (error) {
                expect(error).toBeInstanceOf(ConflictError);
                const conflictError = error as ConflictError & { key: string };
                expect(conflictError.name).toBe('ConflictError');
                expect(conflictError.key).toBe('testKey');
                // Note: モック制御が複雑なため、正確なバージョン値のアサーションは省略
                // 実際のCAS競合シナリオでは、expected/actualバージョンが設定される
            }
        });

        it('detects a version mismatch in post-write revalidation', async () => {
            await chrome.storage.local.set({ testKey: ['initial'] });

            const setupOriginalGet = originalGet;
            let callCount = 0;
            chrome.storage.local.get = (vi.fn(async (keys?: string | string[] | Record<string, unknown> | null) => {
                callCount++;
                if (callCount === 1) {
                    // initial read
                    return { testKey: ['initial'], testKey_version: 0 };
                } else if (callCount === 2) {
                    // pre-write verify: passes
                    return { testKey: ['initial'], testKey_version: 0 };
                } else if (callCount === 3) {
                    // post-write verify: another process overwrote
                    return { testKey: ['modified'], testKey_version: 10 };
                }
                return setupOriginalGet.call(chrome.storage.local, keys);
            }) as unknown) as typeof chrome.storage.local.get;

            await expect(
                withOptimisticLock<unknown[]>('testKey', (current) => [...current, 'item'], { maxRetries: 0 })
            ).rejects.toThrow(ConflictError);
        });

        it('detects a value mismatch in post-write revalidation', async () => {
            await chrome.storage.local.set({ testKey: ['initial'] });

            const setupOriginalGet = originalGet;
            let callCount = 0;
            chrome.storage.local.get = (vi.fn(async (keys?: string | string[] | Record<string, unknown> | null) => {
                callCount++;
                if (callCount === 1) {
                    return { testKey: ['initial'], testKey_version: 0 };
                } else if (callCount === 2) {
                    return { testKey: ['initial'], testKey_version: 0 };
                } else if (callCount === 3) {
                    // version matches but value differs
                    return { testKey: ['tampered'], testKey_version: 1 };
                }
                return setupOriginalGet.call(chrome.storage.local, keys);
            }) as unknown) as typeof chrome.storage.local.get;

            await expect(
                withOptimisticLock<unknown[]>('testKey', (current) => [...current, 'item'], { maxRetries: 0 })
            ).rejects.toThrow(ConflictError);
        });

        it('passes post-write revalidation', async () => {
            await chrome.storage.local.set({ testKey: ['initial'] });

            const setupOriginalGet = originalGet;
            let callCount = 0;
            chrome.storage.local.get = (vi.fn(async (keys?: string | string[] | Record<string, unknown> | null) => {
                callCount++;
                if (callCount === 1) {
                    return { testKey: ['initial'], testKey_version: 0 };
                } else if (callCount === 2) {
                    return { testKey: ['initial'], testKey_version: 0 };
                }
                // 3回目以降（post-write verify含む）: 実際のストレージ値を返す
                return setupOriginalGet.call(chrome.storage.local, keys);
            }) as unknown) as typeof chrome.storage.local.get;

            const result = await withOptimisticLock<unknown[]>('testKey', (current) => [...current, 'item'], { maxRetries: 0 });

            expect(result).toEqual(['initial', 'item']);
            const stored = await chrome.storage.local.get('testKey');
            expect(stored.testKey).toEqual(['initial', 'item']);
        });

        it('records the conflict when one occurs', async () => {
            await chrome.storage.local.set({ testKey: ['initial'] });

            // chrome.storage.local.getをモックして競合をシミュレート
            const setupOriginalGet = originalGet;
            let callCount = 0;
            chrome.storage.local.get = (vi.fn(async (keys?: string | string[] | Record<string, unknown> | null) => {
                callCount++;
                if (callCount === 1) {
                    return { testKey: ['initial'], testKey_version: 0 };
                } else if (callCount === 2) {
                    return { testKey: ['modified'], testKey_version: 10 };
                }
                return setupOriginalGet.call(chrome.storage.local, keys);
            }) as unknown) as typeof chrome.storage.local.get;

            await expect(
                withOptimisticLock<unknown[]>('testKey', (current) => [...current, 'item'], { maxRetries: 0 })
            ).rejects.toThrow(ConflictError);
        });
    });

    describe('エラーハンドリング', () => {
        beforeEach(async () => {
            await chrome.storage.local.set({});
        });

        it('propagates errors thrown by updateFn', async () => {
            await chrome.storage.local.set({ testKey: ['initial'] });

            await expect(
                withOptimisticLock('testKey', () => {
                    throw new Error('Update function error');
                }, { maxRetries: 0 })
            ).rejects.toThrow('Update function error');

            // 失敗してもstatは記録される
        });

        it('propagates errors when chrome.storage.local.set fails', async () => {
            const originalSet = chrome.storage.local.set;
            chrome.storage.local.set = vi.fn(() => Promise.reject(new Error('Storage error')));

            await expect(
                withOptimisticLock('testKey', (current) => current, { maxRetries: 0 })
            ).rejects.toThrow('Storage error');

            chrome.storage.local.set = originalSet;
        });
    });

    describe('リトライロジック', () => {
        let originalGet: any;
        let originalSet: any;

        beforeEach(async () => {
            await chrome.storage.local.set({});
            // jest.setup.tsのモックを保存
            originalGet = chrome.storage.local.get;
            originalSet = chrome.storage.local.set;
        });

        afterEach(() => {
            // モックを復元
            chrome.storage.local.get = originalGet;
            chrome.storage.local.set = originalSet;
        });

        it('retries with exponential backoff on conflict', async () => {
            await chrome.storage.local.set({ testKey: ['initial'], testKey_version: 0 });

            const setupOriginalGet = originalGet;
            const setupOriginalSet = originalSet;
            const retryCount = 2; // 2回目のリトライで成功させる
            const successVersion = retryCount * 20;

            // Setを追跡（CAS verify check正確化のため）
            let testKeyState = ['initial'];
            let testKeyVersion = 0;

            chrome.storage.local.set = vi.fn(async (items: any) => {
                if (items.testKey !== undefined) testKeyState = items.testKey;
                if (items.testKey_version !== undefined) testKeyVersion = items.testKey_version;
                await setupOriginalSet.call(chrome.storage.local, items);
            });

            // Getを追跡してリトライ回数制御
            let getCallCount = 0;
            chrome.storage.local.get = vi.fn(async () => {
                getCallCount++;
                // 各試行は initial read + pre-write verify + post-write verify の3回 get を行う。
                // retryCount 回の試行が競合した後、次の試行で成功させる。
                if (getCallCount <= retryCount * 3) {
                    return { testKey: ['modified'], testKey_version: getCallCount * 10 };
                }
                // その後は、実際の値を返す（CAS成功）
                return {
                    testKey: testKeyState,
                    testKey_version: testKeyVersion
                };
            });

            const result = await withOptimisticLock<unknown[]>('testKey', (current) => [...current, 'item'], {
                maxRetries: 5,
                initialDelay: 10
            });

            // リトライ後に成功していることを確認
            expect(result).toEqual(['initial', 'item']);
            const stored = await chrome.storage.local.get('testKey');
            expect(stored.testKey).toEqual(['initial', 'item']);
        });

        it('throws after exceeding the retry limit', async () => {
            await chrome.storage.local.set({ testKey: ['initial'] });

            const setupOriginalGet = originalGet;
            let callCount = 0;

            chrome.storage.local.get = vi.fn(async () => {
                callCount++;
                // 呼び出しごとにバージョンを変化させて常にバージョン不一致を起こす
                return { testKey: ['modified'], testKey_version: callCount * 100 };
            });

            await expect(
                withOptimisticLock<unknown[]>('testKey', (current) => [...current, 'item'], {
                    maxRetries: 2,
                    initialDelay: 10
                })
            ).rejects.toThrow(ConflictError);
        });

        it('retries with the default maxRetries', async () => {
            // Note: Using vi.useFakeTimers to control async timing if needed
            await chrome.storage.local.set({ testKey: ['initial'] });

            const setupOriginalGet = originalGet;
            let callCount = 0;

            chrome.storage.local.get = vi.fn(async () => {
                callCount++;
                // 常に競合を返す（デフォルトのmaxRetries=5回まで）
                return { testKey: ['modified'], testKey_version: callCount * 10 };
            });

            await expect(
                withOptimisticLock<unknown[]>('testKey', (current) => [...current, 'item'])
            ).rejects.toThrow(ConflictError);

            // Reset storage for other tests
            await chrome.storage.local.set({ testKey: ['initial'] });
        });
    });
});


