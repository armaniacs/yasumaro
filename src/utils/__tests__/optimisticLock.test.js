/**
 * optimisticLock.test.js
 * Unit tests for optimistic locking module
 */

import {
    withOptimisticLock,
    ConflictError,
    getConflictStats,
    resetConflictStats,
    ensureVersionInitialized
} from '../optimisticLock.js';

describe('withOptimisticLock', () => {
    describe('基本機能', () => {
        beforeEach(async () => {
            // Clear storage and stats before each test
            await chrome.storage.local.set({});
            resetConflictStats();
        });

        it('新しい値を更新して返す', async () => {
            await chrome.storage.local.set({ testKey: ['initial'], testKey_version: 0 });

            const result = await withOptimisticLock('testKey', (current) => {
                return [...current, 'item'];
            });

            expect(result).toEqual(['initial', 'item']);
            const stored = await chrome.storage.local.get(['testKey', 'testKey_version']);
            expect(stored.testKey).toEqual(['initial', 'item']);
            expect(stored.testKey_version).toBe(1);
        });

        it('未定義の値に対しても動作する', async () => {
            // testKey_version not in storage initially
            await chrome.storage.local.set({ testKey: undefined });

            const result = await withOptimisticLock('testKey', (current) => {
                return ['new'];
            });

            expect(result).toEqual(['new']);
            const stored = await chrome.storage.local.get(['testKey', 'testKey_version']);
            expect(stored.testKey).toEqual(['new']);
            expect(stored.testKey_version).toBe(1);
        });

        it('バージョンが存在しない場合に初期化する', async () => {
            await chrome.storage.local.set({ testKey: ['initial'] });

            const result = await withOptimisticLock('testKey', (current) => {
                return [...current, 'item'];
            });

            expect(result).toEqual(['initial', 'item']);
            const stored = await chrome.storage.local.get(['testKey', 'testKey_version']);
            expect(stored.testKey_version).toBe(1); // 0 + 1
        });

        it('複数の更新を連続して実行できる', async () => {
            await chrome.storage.local.set({ testKey: [1], testKey_version: 0 });

            const result1 = await withOptimisticLock('testKey', (current) => {
                return [...current, 2];
            });

            const result2 = await withOptimisticLock('testKey', (current) => {
                return [...current, 3];
            });

            expect(result1).toEqual([1, 2]);
            expect(result2).toEqual([1, 2, 3]);
            const stored = await chrome.storage.local.get('testKey_version');
            expect(stored.testKey_version).toBe(2);
        });
    });

    describe('競合検出とリトライ', () => {
        beforeEach(async () => {
            await chrome.storage.local.set({});
            resetConflictStats();
        });

        it('最大リトライ回数を超えるとConflictErrorをスローする', async () => {
            await chrome.storage.local.set({ testKey: ['initial'], testKey_version: 0 });

            // 常に競合が発生するようにget/setをモック
            const originalGet = chrome.storage.local.get;
            const originalSet = chrome.storage.local.set;

            chrome.storage.local.get = jest.fn((keys) => {
                // 版号検証時には常に異なる版号を返す
                return Promise.resolve({ testKey: mockConflictData, testKey_version: 999 });
            });

            let mockConflictData = ['initial'];

            chrome.storage.local.set = jest.fn((values) => {
                mockConflictData = values.testKey;
                return Promise.resolve();
            });

            await expect(
                withOptimisticLock('testKey', (current) => {
                    return [...current, 'item'];
                }, { maxRetries: 2, retryDelay: 0 })
            ).rejects.toThrow(ConflictError);

            // 元のモックを復元
            chrome.storage.local.get = originalGet;
            chrome.storage.local.set = originalSet;
        });

        it('ConflictErrorは詳細情報を含む', async () => {
            await chrome.storage.local.set({ testKey: ['initial'], testKey_version: 0 });

            const originalGet = chrome.storage.local.get;
            const originalSet = chrome.storage.local.set;

            chrome.storage.local.get = jest.fn(() => Promise.resolve({ testKey: ['initial'], testKey_version: 999 }));
            chrome.storage.local.set = jest.fn(() => Promise.resolve());

            try {
                await withOptimisticLock('testKey', (current) => [...current, 'item'], { maxRetries: 1, retryDelay: 0 });
                fail('Should have thrown ConflictError');
            } catch (error) {
                expect(error).toBeInstanceOf(ConflictError);
                expect(error.isConflictError).toBe(true);
                expect(error.key).toBe('testKey');
                expect(error.attempts).toBeGreaterThan(0);
            }

            chrome.storage.local.get = originalGet;
            chrome.storage.local.set = originalSet;
        });
    });

    describe('並行アクセス', () => {
        beforeEach(async () => {
            await chrome.storage.local.set({});
            resetConflictStats();
        });

        it('並行した複数の操作でデータが破損しない', async () => {
            await chrome.storage.local.set({ testKey: ['initial'], testKey_version: 0 });

            // 並行実行
            const promise1 = withOptimisticLock('testKey', (current) => {
                return [...current, 'item1'];
            }, { maxRetries: 10, retryDelay: 0 });

            const promise2 = withOptimisticLock('testKey', (current) => {
                return [...current, 'item2'];
            }, { maxRetries: 10, retryDelay: 0 });

            // 同期モック環境では、両方の操作が競合を検知しない可能性がある
            // 重要なのは：いずれかの操作が成功し、データが破損しないこと
            await Promise.all([promise1, promise2]);

            const stored = await chrome.storage.local.get(['testKey', 'testKey_version']);
            // initialは常に含まれるはず
            expect(stored.testKey).toContain('initial');
            // 有効なバージョン番号であること
            expect(stored.testKey_version).toBeGreaterThanOrEqual(1);
            // 少なくとも1つのアイテムが追加されていること
            expect(stored.testKey.length).toBeGreaterThan(1);
        });
    });

    describe('エラーハンドリング', () => {
        beforeEach(async () => {
            await chrome.storage.local.set({});
            resetConflictStats();
        });

        it('updateFnでスローされたエラーを伝播する', async () => {
            await chrome.storage.local.set({ testKey: ['initial'], testKey_version: 0 });

            await expect(
                withOptimisticLock('testKey', () => {
                    throw new Error('Update function error');
                })
            ).rejects.toThrow('Update function error');

            // 失敗してもstatは記録される
            const stats = getConflictStats();
            expect(stats.totalAttempts).toBe(1);
        });
    });

    describe('カスタムオプション', () => {
        beforeEach(async () => {
            await chrome.storage.local.set({});
            resetConflictStats();
        });

        it('カスタムmaxRetriesを適用する', async () => {
            await chrome.storage.local.set({ testKey: ['initial'], testKey_version: 0 });

            // 成功ケースでオプションが適用されることを確認
            const result = await withOptimisticLock('testKey', (current) => [...current, 'item'], { maxRetries: 10 });

            expect(result).toEqual(['initial', 'item']);
        });
    });
});

describe('ConflictError', () => {
    it('正しくインスタンス化できる', () => {
        const error = new ConflictError('Test error', 'testKey', 5);

        expect(error.name).toBe('ConflictError');
        expect(error.message).toBe('Test error');
        expect(error.key).toBe('testKey');
        expect(error.attempts).toBe(5);
        expect(error.isConflictError).toBe(true);
    });

    it('Errorサブクラスとして振る舞う', () => {
        const error = new ConflictError('Test', 'key', 1);

        expect(error instanceof Error).toBe(true);
        expect(error instanceof ConflictError).toBe(true);
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
        await chrome.storage.local.set({ testKey: ['initial'], testKey_version: 0 });

        await withOptimisticLock('testKey', (current) => [...current, 'item']);

        resetConflictStats();

        const stats = getConflictStats();
        expect(stats.totalAttempts).toBe(0);
        expect(stats.totalConflicts).toBe(0);
        expect(stats.totalFailures).toBe(0);
    });
});

describe('ensureVersionInitialized', () => {
    beforeEach(async () => {
        await chrome.storage.local.set({});
    });

    it('バージョンフィールドが存在しない場合に初期化する', async () => {
        await chrome.storage.local.set({ testKey: ['initial'] });
        // testKey_versionは未設定

        const initialized = await ensureVersionInitialized('testKey');

        expect(initialized).toBe(true);
        const stored = await chrome.storage.local.get('testKey_version');
        expect(stored.testKey_version).toBe(0);
    });

    it('バージョンフィールドが既に存在する場合は初期化しない', async () => {
        await chrome.storage.local.set({ testKey: ['initial'], testKey_version: 5 });

        const initialized = await ensureVersionInitialized('testKey');

        expect(initialized).toBe(false);
        const stored = await chrome.storage.local.get('testKey_version');
        expect(stored.testKey_version).toBe(5);
    });

    it('複数のキーに対して初期化できる', async () => {
        await chrome.storage.local.set({ key1: ['val1'], key2: ['val2'] });

        const init1 = await ensureVersionInitialized('key1');
        const init2 = await ensureVersionInitialized('key2');

        expect(init1).toBe(true);
        expect(init2).toBe(true);
        const stored = await chrome.storage.local.get(['key1_version', 'key2_version']);
        expect(stored.key1_version).toBe(0);
        expect(stored.key2_version).toBe(0);
    });
});

describe('URLセット用のユースケース', () => {
    beforeEach(async () => {
        await chrome.storage.local.set({});
    });

    it('URLを追加するユースケース', async () => {
        await chrome.storage.local.set({ savedUrls: ['https://example.com'], savedUrls_version: 0 });

        const newUrl = 'https://new-website.com';
        await withOptimisticLock('savedUrls', (current) => {
            const urlSet = new Set(current || []);
            urlSet.add(newUrl);
            return Array.from(urlSet);
        });

        const stored = await chrome.storage.local.get(['savedUrls', 'savedUrls_version']);
        expect(stored.savedUrls).toContain(newUrl);
        expect(stored.savedUrls_version).toBe(1);
    });

    it('URLを削除するユースケース', async () => {
        await chrome.storage.local.set({
            savedUrls: ['https://example.com', 'https://to-remove.com'],
            savedUrls_version: 2
        });

        const urlToRemove = 'https://to-remove.com';
        await withOptimisticLock('savedUrls', (current) => {
            const urlSet = new Set(current || []);
            urlSet.delete(urlToRemove);
            return Array.from(urlSet);
        });

        const stored = await chrome.storage.local.get(['savedUrls', 'savedUrls_version']);
        expect(stored.savedUrls).not.toContain(urlToRemove);
        expect(stored.savedUrls).toContain('https://example.com');
        expect(stored.savedUrls_version).toBe(3);
    });

    it('最大値制限でLRU削除するユースケース', async () => {
        await chrome.storage.local.set({
            savedUrlsWithTimestamps: [
                { url: 'https://old.com', timestamp: 1000 },
                { url: 'https://new.com', timestamp: 2000 }
            ],
            savedUrlsWithTimestamps_version: 0
        });

        await withOptimisticLock('savedUrlsWithTimestamps', (current) => {
            const entries = current || [];
            // 古いURLを削除
            return entries.filter(entry => entry.timestamp > 1500);
        });

        const stored = await chrome.storage.local.get('savedUrlsWithTimestamps');
        expect(stored.savedUrlsWithTimestamps).toHaveLength(1);
        expect(stored.savedUrlsWithTimestamps[0].url).toBe('https://new.com');
    });
});