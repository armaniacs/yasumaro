/**
 * aiUsageTracker.test.ts
 * aiUsageTracker.ts の単体テスト
 */

import { webcrypto as crypto } from '@peculiar/webcrypto';
Object.defineProperty(global, 'crypto', { value: crypto });

// StorageKeys モック
vi.mock('../storage.js', () => ({
    StorageKeys: {
        AI_RATE_LIMIT_WINDOW_START: 'ai_rate_limit_window_start',
        AI_RATE_LIMIT_COUNT: 'ai_rate_limit_count',
        AI_RATE_LIMIT_MAX: 'ai_rate_limit_max',
        AI_USAGE_MONTH: 'ai_usage_month',
        AI_USAGE_TOKENS_SENT: 'ai_usage_tokens_sent',
        AI_USAGE_TOKENS_RECEIVED: 'ai_usage_tokens_received',
        AI_USAGE_REQUEST_COUNT: 'ai_usage_request_count',
        MAX_MONTHLY_TOKENS: 'max_monthly_tokens'
    }
}));

// logger モック
vi.mock('../logger.js', () => ({
    addLog: vi.fn(),
    LogType: { WARN: 'warn', ERROR: 'error', INFO: 'info', DEBUG: 'debug' }
}));

// chrome API モック
const mockStorage: Record<string, any> = {};
const mockChrome = {
    storage: {
        local: {
            get: vi.fn(async (keys: string | string[] | Record<string, any>) => {
                const result: Record<string, any> = {};
                if (typeof keys === 'string') {
                    if (keys in mockStorage) result[keys] = mockStorage[keys];
                } else if (Array.isArray(keys)) {
                    for (const key of keys) {
                        if (key in mockStorage) result[key] = mockStorage[key];
                    }
                } else if (keys && typeof keys === 'object') {
                    for (const key of Object.keys(keys)) {
                        if (key in mockStorage) result[key] = mockStorage[key];
                    }
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

import {
    checkRateLimit,
    getMonthlyUsage,
    recordUsage,
    getRateLimitMessage,
    checkUsageWarning,
    checkHardLimit
} from '../aiUsageTracker.js';

describe('aiUsageTracker', () => {

    beforeEach(() => {
        Object.keys(mockStorage).forEach(key => delete mockStorage[key]);
        vi.clearAllMocks();
    });

    describe('checkRateLimit', () => {
        test('初回は許可される', async () => {
            const result = await checkRateLimit();
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(9);
        });

        test('ウィンドウ内のリクエスト数を追跡する', async () => {
            const now = Date.now();
            mockStorage['ai_rate_limit_window_start'] = now;
            mockStorage['ai_rate_limit_count'] = 5;

            const result = await checkRateLimit();
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(4);
        });

        test('10回以上は拒否される', async () => {
            const now = Date.now();
            mockStorage['ai_rate_limit_window_start'] = now;
            mockStorage['ai_rate_limit_count'] = 10;

            const result = await checkRateLimit();
            expect(result.allowed).toBe(false);
            expect(result.remaining).toBe(0);
        });

        test('ウィンドウ期限切れでリセットされる', async () => {
            const oldTime = Date.now() - 61000;
            mockStorage['ai_rate_limit_window_start'] = oldTime;
            mockStorage['ai_rate_limit_count'] = 10;

            const result = await checkRateLimit();
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(9);
        });

        test('count が undefined の場合は 0 から開始', async () => {
            const now = Date.now();
            mockStorage['ai_rate_limit_window_start'] = now;

            const result = await checkRateLimit();
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(9);
        });

        test('AI_RATE_LIMIT_MAX 設定値を参照する', async () => {
            mockStorage['ai_rate_limit_max'] = 5;
            const now = Date.now();
            mockStorage['ai_rate_limit_window_start'] = now;
            mockStorage['ai_rate_limit_count'] = 5;

            const result = await checkRateLimit();
            expect(result.allowed).toBe(false);
            expect(result.remaining).toBe(0);
        });

        test('AI_RATE_LIMIT_MAX が未設定の場合はデフォルト 10 を使用する', async () => {
            const now = Date.now();
            mockStorage['ai_rate_limit_window_start'] = now;
            mockStorage['ai_rate_limit_count'] = 9;

            const result = await checkRateLimit();
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(0);
        });
    });

    describe('getMonthlyUsage', () => {
        test('デフォルトの月間使用量を返す', async () => {
            const result = await getMonthlyUsage();
            expect(result.tokensSent).toBe(0);
            expect(result.tokensReceived).toBe(0);
            expect(result.requestCount).toBe(0);
        });

        test('保存された使用量を返す', async () => {
            const now = new Date();
            const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            mockStorage['ai_usage_month'] = monthKey;
            mockStorage['ai_usage_tokens_sent'] = 1000;
            mockStorage['ai_usage_tokens_received'] = 2000;
            mockStorage['ai_usage_request_count'] = 5;

            const result = await getMonthlyUsage();
            expect(result.tokensSent).toBe(1000);
            expect(result.tokensReceived).toBe(2000);
            expect(result.requestCount).toBe(5);
        });

        test('月が変わった場合はリセットする', async () => {
            mockStorage['ai_usage_month'] = '2020-01';
            mockStorage['ai_usage_tokens_sent'] = 9999;

            const result = await getMonthlyUsage();
            expect(result.tokensSent).toBe(0);
        });

        test('トークン数が未設定の場合は0を返す', async () => {
            const now = new Date();
            const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            mockStorage['ai_usage_month'] = monthKey;

            const result = await getMonthlyUsage();
            expect(result.tokensSent).toBe(0);
            expect(result.tokensReceived).toBe(0);
            expect(result.requestCount).toBe(0);
            expect(result.month).toBe(monthKey);
        });
    });

    describe('recordUsage', () => {
        test('使用量を記録する', async () => {
            await recordUsage(100, 200);

            expect(mockChrome.storage.local.set).toHaveBeenCalled();
        });

        test('既存の使用量に加算する', async () => {
            const now = new Date();
            const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            mockStorage['ai_usage_month'] = monthKey;
            mockStorage['ai_usage_tokens_sent'] = 100;
            mockStorage['ai_usage_tokens_received'] = 200;

            await recordUsage(50, 50);

            const callArg = mockChrome.storage.local.set.mock.calls[0][0];
            expect(callArg['ai_usage_tokens_sent']).toBe(150);
            expect(callArg['ai_usage_tokens_received']).toBe(250);
        });
    });

    describe('getRateLimitMessage', () => {
        test('レート制限メッセージを返す', () => {
            const futureTime = Date.now() + 30000;
            const message = getRateLimitMessage(futureTime);
            expect(message).toContain('Rate limit');
            expect(message).toContain('seconds');
        });

        test('秒数を計算する', () => {
            const futureTime = Date.now() + 5000;
            const message = getRateLimitMessage(futureTime);
            expect(message).toMatch(/\d+ seconds/);
        });
    });

    describe('checkUsageWarning', () => {
        test('100万トークン以下は警告なし', async () => {
            const now = new Date();
            const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            mockStorage['ai_usage_month'] = monthKey;
            mockStorage['ai_usage_tokens_sent'] = 100000;
            mockStorage['ai_usage_tokens_received'] = 100000;

            const result = await checkUsageWarning();
            expect(result.warning).toBe(false);
        });

        test('100万トークン超過で警告あり', async () => {
            const now = new Date();
            const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            mockStorage['ai_usage_month'] = monthKey;
            mockStorage['ai_usage_tokens_sent'] = 500000;
            mockStorage['ai_usage_tokens_received'] = 600000;

            const result = await checkUsageWarning();
            expect(result.warning).toBe(true);
            expect(result.message).toBeDefined();
        });

        test('MAX_MONTHLY_TOKENS が 0 の場合は警告なし', async () => {
            const now = new Date();
            const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            mockStorage['ai_usage_month'] = monthKey;
            mockStorage['ai_usage_tokens_sent'] = 2000000;
            mockStorage['ai_usage_tokens_received'] = 2000000;
            mockStorage['max_monthly_tokens'] = 0;

            const result = await checkUsageWarning();
            expect(result.warning).toBe(false);
        });
    });

    describe('checkHardLimit', () => {
        test('月次使用量が上限未満の場合はブロックしない', async () => {
            const now = new Date();
            const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            mockStorage['ai_usage_month'] = monthKey;
            mockStorage['ai_usage_tokens_sent'] = 20000;
            mockStorage['ai_usage_tokens_received'] = 20000;
            mockStorage['max_monthly_tokens'] = 50000;

            const result = await checkHardLimit(5000);
            expect(result.blocked).toBe(false);
        });

        test('予定使用量を含めて上限を超える場合はブロックする', async () => {
            const now = new Date();
            const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            mockStorage['ai_usage_month'] = monthKey;
            mockStorage['ai_usage_tokens_sent'] = 25000;
            mockStorage['ai_usage_tokens_received'] = 25000;
            mockStorage['max_monthly_tokens'] = 50000;

            const result = await checkHardLimit(200);
            expect(result.blocked).toBe(true);
            expect(result.message).toContain('Monthly token limit reached');
        });

        test('MAX_MONTHLY_TOKENS が 0 の場合は無制限としてブロックしない', async () => {
            const now = new Date();
            const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            mockStorage['ai_usage_month'] = monthKey;
            mockStorage['ai_usage_tokens_sent'] = 2000000;
            mockStorage['ai_usage_tokens_received'] = 2000000;
            mockStorage['max_monthly_tokens'] = 0;

            const result = await checkHardLimit(1000);
            expect(result.blocked).toBe(false);
        });

        test('MAX_MONTHLY_TOKENS が未設定の場合はデフォルト 100 万を使用する', async () => {
            const now = new Date();
            const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            mockStorage['ai_usage_month'] = monthKey;
            mockStorage['ai_usage_tokens_sent'] = 900000;
            mockStorage['ai_usage_tokens_received'] = 100000;

            const result = await checkHardLimit(1);
            expect(result.blocked).toBe(true);
        });
    });
});
