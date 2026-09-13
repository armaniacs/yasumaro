/**
 * trancoUpdater.test.ts
 * trancoUpdater.ts の単体テスト
 */

import type { Mock } from 'vitest';
import { Crypto } from '@peculiar/webcrypto';
Object.defineProperty(global, 'crypto', {
    value: new Crypto()
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

// trustDb モック — mutation seam owns lifecycle (TrustDbAdmin)
const mockDb = {
    initialize: vi.fn(async () => {}),
    updateTranco: vi.fn(async () => {}),
    getStatus: vi.fn((): { initialized: boolean; version?: string; lastUpdated?: string; trancoTier?: string; trancoCount?: number } => ({ initialized: true, lastUpdated: new Date().toISOString() }))
};
vi.mock('../TrustDbAdmin.js', () => ({
    getTrustDbAdmin: vi.fn(() => mockDb)
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
        test('SAFETY_MODE_TO_TRANCO_TIER is correct', () => {
            expect(SAFETY_MODE_TO_TRANCO_TIER.strict).toBe('top1k');
            expect(SAFETY_MODE_TO_TRANCO_TIER.balanced).toBe('top10k');
            expect(SAFETY_MODE_TO_TRANCO_TIER.relaxed).toBe('top100k');
        });

        test('TRANCO_TIER_TO_SAFETY_MODE is correct', () => {
            expect(TRANCO_TIER_TO_SAFETY_MODE.top1k).toBe('strict');
            expect(TRANCO_TIER_TO_SAFETY_MODE.top10k).toBe('balanced');
            expect(TRANCO_TIER_TO_SAFETY_MODE.top100k).toBe('relaxed');
        });

        test('mappings agree bidirectionally', () => {
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

        test('updateInProgress is false in initial state', () => {
            expect(updater.isUpdateInProgress()).toBe(false);
        });

        test('safetyModeToTier converts correctly', () => {
            expect(updater.safetyModeToTier('strict')).toBe('top1k');
            expect(updater.safetyModeToTier('balanced')).toBe('top10k');
            expect(updater.safetyModeToTier('relaxed')).toBe('top100k');
        });

        test('tierToSafetyMode converts correctly', () => {
            expect(updater.tierToSafetyMode('top1k')).toBe('strict');
            expect(updater.tierToSafetyMode('top10k')).toBe('balanced');
            expect(updater.tierToSafetyMode('top100k')).toBe('relaxed');
        });

        describe('updateTrancoList', () => {
            test('returns an error when an update is already in progress', async () => {
                // updateInProgress を true にする（内部状態アクセス）
                (updater as any).updateInProgress = true;

                const result = await updater.updateTrancoList('top1k');

                expect(result.success).toBe(false);
                expect(result.error).toBe('Update already in progress');
            });

            test('returns domain count and size on success', async () => {
                const csvText = '1,google.com\n2,youtube.com\n3,facebook.com';
                (fetchWithTimeout as Mock).mockResolvedValue({
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

            test('aborts chunked CSV exceeding 50MB without Content-Length and returns an error', async () => {
                const huge = new Uint8Array(51 * 1024 * 1024); // 51MB in one chunk
                let reads = 0;
                (fetchWithTimeout as Mock).mockResolvedValue({
                    ok: true,
                    status: 200,
                    json: async () => ({ list_id: 'test-list-id' }),
                    headers: { get: () => null },
                    body: {
                        getReader: () => {
                            let sent = false;
                            return {
                                read: () => {
                                    reads += 1;
                                    if (sent) return Promise.resolve({ done: true, value: undefined });
                                    sent = true;
                                    return Promise.resolve({ done: false, value: huge });
                                },
                                cancel: () => Promise.resolve(),
                            };
                        },
                    },
                });

                const resultPromise = updater.updateTrancoList('top1k');
                await vi.advanceTimersByTimeAsync(1000);
                await vi.advanceTimersByTimeAsync(2000);
                await vi.advanceTimersByTimeAsync(4000);
                const result = await resultPromise;

                expect(result.success).toBe(false);
                expect(reads).toBeGreaterThan(0);
            });

            test('retries on API failure and finally returns an error', async () => {
                (fetchWithTimeout as Mock).mockResolvedValue({
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

            test('returns an error when list_id is missing', async () => {
                (fetchWithTimeout as Mock).mockResolvedValue({
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
            test('requires an update on first run', async () => {
                mockDb.getStatus.mockReturnValueOnce({ initialized: false });

                const result = await updater.isUpdateNeeded('top1k');
                expect(result).toBe(true);
            });

            test('requires an update when lastUpdated is missing', async () => {
                mockDb.getStatus.mockReturnValueOnce({ initialized: true });

                const result = await updater.isUpdateNeeded('top1k');
                expect(result).toBe(true);
            });

            test('does not require an update when recently updated', async () => {
                mockDb.getStatus.mockReturnValueOnce({
                    initialized: true,
                    lastUpdated: new Date().toISOString()
                });

                const result = await updater.isUpdateNeeded('top1k');
                expect(result).toBe(false);
            });

            test('requires an update when 24 hours have elapsed', async () => {
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
        test('returns a TrancoUpdater instance', () => {
            const updater = getTrancoUpdater();
            expect(updater).toBeInstanceOf(TrancoUpdater);
        });

        test('returns the singleton instance', () => {
            const updater1 = getTrancoUpdater();
            const updater2 = getTrancoUpdater();
            expect(updater1).toBe(updater2);
        });
    });
});
