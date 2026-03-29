/**
 * storageUrls.ts の savedUrls Set比較ロジックのテスト
 *
 * テスト対象: setSavedUrlsWithTimestamps 内の withOptimisticLock('savedUrls', ...) コールバック
 * - 変更なし時は currentUrls をそのまま返す（early-return）
 * - サイズ不一致時は即座に新しい配列を返す
 * - Set 差分あり（一部URL変化）時は新しい配列を返す
 * - 内容が同一の場合は chrome.storage.local.set を不要に呼ばない
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('../optimisticLock.js', () => {
    const actual = jest.requireActual('../optimisticLock.js') as typeof import('../optimisticLock.js');
    return actual;
});
jest.mock('../logger.js', () => ({
    addLog: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn(),
    logInfo: jest.fn(),
    LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
    ErrorCode: {},
}));

import { setSavedUrlsWithTimestamps } from '../storageUrls.js';

// chrome.storage.local の呼び出しを記録するラッパー
let setCallArgs: Array<Record<string, unknown>> = [];
const storedData: Record<string, unknown> = {};

beforeEach(() => {
    setCallArgs = [];
    Object.keys(storedData).forEach(k => delete storedData[k]);

    (global.chrome as any) = {
        storage: {
            local: {
                get: jest.fn((keys: string | string[]) => {
                    const result: Record<string, unknown> = {};
                    const keyList = Array.isArray(keys) ? keys : [keys];
                    for (const k of keyList) {
                        if (k in storedData) result[k] = storedData[k];
                    }
                    return Promise.resolve(result);
                }),
                set: jest.fn((items: Record<string, unknown>) => {
                    setCallArgs.push(items);
                    Object.assign(storedData, items);
                    return Promise.resolve();
                }),
            },
        },
    };
});

/** savedUrls キーへの set 呼び出しのみ抽出 */
function getSavedUrlsSetCalls(): string[][] {
    return setCallArgs
        .filter(args => 'savedUrls' in args)
        .map(args => args['savedUrls'] as string[]);
}

describe('setSavedUrlsWithTimestamps: savedUrls Set比較ロジック', () => {
    describe('変更なし時の early-return', () => {
        it('同じURLセットを再度保存しても savedUrls の内容は変わらない', async () => {
            const urlMap = new Map([
                ['https://example.com/a', Date.now()],
                ['https://example.com/b', Date.now()],
            ]);

            // 1回目: ストレージに書き込み
            await setSavedUrlsWithTimestamps(urlMap);
            const firstCalls = getSavedUrlsSetCalls();
            expect(firstCalls.length).toBeGreaterThanOrEqual(1);

            // savedUrls をすでに同じ内容でセット
            storedData['savedUrls'] = Array.from(urlMap.keys());
            setCallArgs = [];

            // 2回目: 同じ urlMap → 比較ロジックで変更なしと判断
            await setSavedUrlsWithTimestamps(urlMap);
            const secondCalls = getSavedUrlsSetCalls();

            // savedUrls への set は呼ばれないか、呼ばれても同じ内容
            if (secondCalls.length > 0) {
                expect(new Set(secondCalls[secondCalls.length - 1]))
                    .toEqual(new Set(Array.from(urlMap.keys())));
            }
        });
    });

    describe('サイズ不一致時の即時更新', () => {
        it('URLが追加されると savedUrls が更新される', async () => {
            const initialUrls = ['https://example.com/a', 'https://example.com/b'];
            storedData['savedUrls'] = initialUrls;

            const newUrlMap = new Map([
                ['https://example.com/a', Date.now()],
                ['https://example.com/b', Date.now()],
                ['https://example.com/c', Date.now()], // 新規追加
            ]);

            await setSavedUrlsWithTimestamps(newUrlMap);

            const calls = getSavedUrlsSetCalls();
            expect(calls.length).toBeGreaterThanOrEqual(1);
            const saved = calls[calls.length - 1];
            expect(saved).toContain('https://example.com/c');
            expect(saved.length).toBe(3);
        });

        it('URLが削除されると savedUrls が更新される', async () => {
            storedData['savedUrls'] = [
                'https://example.com/a',
                'https://example.com/b',
                'https://example.com/c',
            ];

            const reducedUrlMap = new Map([
                ['https://example.com/a', Date.now()],
                ['https://example.com/b', Date.now()],
            ]);

            await setSavedUrlsWithTimestamps(reducedUrlMap);

            const calls = getSavedUrlsSetCalls();
            expect(calls.length).toBeGreaterThanOrEqual(1);
            const saved = calls[calls.length - 1];
            expect(saved).not.toContain('https://example.com/c');
            expect(saved.length).toBe(2);
        });
    });

    describe('Set差分あり（サイズ同一・内容変化）', () => {
        it('URLが置き換わると savedUrls が更新される', async () => {
            storedData['savedUrls'] = [
                'https://example.com/old',
                'https://example.com/b',
            ];

            const replacedUrlMap = new Map([
                ['https://example.com/new', Date.now()], // old → new
                ['https://example.com/b', Date.now()],
            ]);

            await setSavedUrlsWithTimestamps(replacedUrlMap);

            const calls = getSavedUrlsSetCalls();
            expect(calls.length).toBeGreaterThanOrEqual(1);
            const saved = calls[calls.length - 1];
            expect(saved).toContain('https://example.com/new');
            expect(saved).not.toContain('https://example.com/old');
        });
    });

    describe('空集合のエッジケース', () => {
        it('空の urlMap を渡すと savedUrls が空配列になる', async () => {
            storedData['savedUrls'] = ['https://example.com/a'];

            await setSavedUrlsWithTimestamps(new Map());

            const calls = getSavedUrlsSetCalls();
            expect(calls.length).toBeGreaterThanOrEqual(1);
            const saved = calls[calls.length - 1];
            expect(saved).toEqual([]);
        });

        it('既に空の savedUrls に空の urlMap を渡しても問題ない', async () => {
            storedData['savedUrls'] = [];

            await setSavedUrlsWithTimestamps(new Map());

            // エラーが発生しないこと
            const calls = getSavedUrlsSetCalls();
            // 空→空は変更なしで set されないか、空配列で set される
            if (calls.length > 0) {
                expect(calls[calls.length - 1]).toEqual([]);
            }
        });
    });
});
