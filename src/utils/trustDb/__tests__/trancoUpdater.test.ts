/**
 * trancoUpdater.test.ts
 * trancoUpdater.ts の単体テスト
 */

import { webcrypto as crypto } from '@peculiar/webcrypto';
Object.defineProperty(global, 'crypto', {
    value: crypto
});

// logger モック
vi.mock('../../logger.js', () => ({
    logInfo: vi.fn(),
    logError: vi.fn(),
    logWarn: vi.fn(),
    ErrorCode: { TRANCO_FETCH_FAILED: 'TRANCO_FETCH_FAILED' }
}));

// fetch モック
vi.mock('../../fetch.js', () => ({
    fetchWithTimeout: vi.fn()
}));

// trustDb モック
const mockDb = {
    initialize: vi.fn(async () => {}),
    updateTranco: vi.fn(async () => {}),
    getStatus: vi.fn(() => ({ initialized: true, lastUpdated: new Date().toISOString() }))
};
vi.mock('../trustDb.js', () => ({
    getTrustDb: vi.fn(() => mockDb)
}));

import {
    TrancoUpdater,
    SAFETY_MODE_TO_TRANCO_TIER,
    TRANCO_TIER_TO_SAFETY_MODE,
    getTrancoUpdater
} from '../trancoUpdater.js';
import { fetchWithTimeout } from '../../fetch.js';

describe('trancoUpdater', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('定数マッピング', () => {
        test('SAFETY_MODE_TO_TRANCO_TIER が正しい', () => {
            expect(SAFETY_MODE_TO_TRANCO_TIER.strict).toBe('top1k');
            expect(SAFETY_MODE_TO_TRANCO_TIER.balanced).toBe('top10k');
            expect(SAFETY_MODE_TO_TRANCO_TIER.relaxed).toBe('top100k');
        });

        test('TRANCO_TIER_TO_SAFETY_MODE が正しい', () => {
            expect(TRANCO_TIER_TO_SAFETY_MODE.top1k).toBe('strict');
            expect(TRANCO_TIER_TO_SAFETY_MODE.top10k).toBe('balanced');
            expect(TRANCO_TIER_TO_SAFETY_MODE.top100k).toBe('relaxed');
        });

        test('マッピングが双方向で一致する', () => {
            for (const [mode, tier] of Object.entries(SAFETY_MODE_TO_TRANCO_TIER)) {
                expect(TRANCO_TIER_TO_SAFETY_MODE[tier]).toBe(mode);
            }
        });
    });

    describe('TrancoUpdater クラス', () => {
        let updater: TrancoUpdater;

        beforeEach(() => {
            updater = new TrancoUpdater();
        });

        test('初期状態では updateInProgress は false', () => {
            expect(updater.isUpdateInProgress()).toBe(false);
        });

        test('safetyModeToTier が正しい変換をする', () => {
            expect(updater.safetyModeToTier('strict')).toBe('top1k');
            expect(updater.safetyModeToTier('balanced')).toBe('top10k');
            expect(updater.safetyModeToTier('relaxed')).toBe('top100k');
        });

        test('tierToSafetyMode が正しい変換をする', () => {
            expect(updater.tierToSafetyMode('top1k')).toBe('strict');
            expect(updater.tierToSafetyMode('top10k')).toBe('balanced');
            expect(updater.tierToSafetyMode('top100k')).toBe('relaxed');
        });

        describe('updateTrancoList', () => {
            test('更新中の場合はエラーを返す', async () => {
                // updateInProgress を true にする（内部状態アクセス）
                (updater as any).updateInProgress = true;

                const result = await updater.updateTrancoList('top1k');

                expect(result.success).toBe(false);
                expect(result.error).toBe('Update already in progress');
            });

            test('成功時にドメイン数とサイズを返す', async () => {
                const csvText = '1,google.com\n2,youtube.com\n3,facebook.com';
                (fetchWithTimeout as vi.Mock).mockResolvedValue({
                    ok: true,
                    status: 200,
                    json: async () => ({ list_id: 'test-list-id' }),
                    text: async () => csvText
                });

                const result = await updater.updateTrancoList('top1k');

                expect(result.success).toBe(true);
                expect(result.domainsCount).toBe(3);
                expect(result.sizeBytes).toBeGreaterThan(0);
            });

            test('API失敗時にリトライして最終的にエラーを返す', async () => {
                (fetchWithTimeout as vi.Mock).mockResolvedValue({
                    ok: false,
                    status: 500,
                    statusText: 'Internal Server Error'
                });

                const promise = updater.updateTrancoList('top1k');

                // タイマーを進めてリトライを実行
                await vi.advanceTimersByTimeAsync(1000);
                await vi.advanceTimersByTimeAsync(2000);
                await vi.advanceTimersByTimeAsync(4000);

                const result = await promise;

                expect(result.success).toBe(false);
                expect(result.error).toBeDefined();
            });

            test('list_id がない場合にエラーを返す', async () => {
                (fetchWithTimeout as vi.Mock).mockResolvedValue({
                    ok: true,
                    status: 200,
                    json: async () => ({})
                });

                const promise = updater.updateTrancoList('top1k');

                await vi.advanceTimersByTimeAsync(1000);
                await vi.advanceTimersByTimeAsync(2000);
                await vi.advanceTimersByTimeAsync(4000);

                const result = await promise;

                expect(result.success).toBe(false);
                expect(result.error).toContain('missing list_id');
            });
        });

        describe('isUpdateNeeded', () => {
            test('初回は更新が必要', async () => {
                mockDb.getStatus.mockReturnValueOnce({ initialized: false });

                const result = await updater.isUpdateNeeded('top1k');
                expect(result).toBe(true);
            });

            test('lastUpdated がない場合は更新が必要', async () => {
                mockDb.getStatus.mockReturnValueOnce({ initialized: true, lastUpdated: null });

                const result = await updater.isUpdateNeeded('top1k');
                expect(result).toBe(true);
            });

            test('最近更新済みの場合は更新不要', async () => {
                mockDb.getStatus.mockReturnValueOnce({
                    initialized: true,
                    lastUpdated: new Date().toISOString()
                });

                const result = await updater.isUpdateNeeded('top1k');
                expect(result).toBe(false);
            });

            test('24時間経過している場合は更新が必要', async () => {
                const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
                mockDb.getStatus.mockReturnValueOnce({
                    initialized: true,
                    lastUpdated: oldDate
                });

                const result = await updater.isUpdateNeeded('top1k');
                expect(result).toBe(true);
            });
        });
    });

    describe('getTrancoUpdater', () => {
        test('TrancoUpdater インスタンスを返す', () => {
            const updater = getTrancoUpdater();
            expect(updater).toBeInstanceOf(TrancoUpdater);
        });

        test('シングルトンインスタンスを返す', () => {
            const updater1 = getTrancoUpdater();
            const updater2 = getTrancoUpdater();
            expect(updater1).toBe(updater2);
        });
    });
});
