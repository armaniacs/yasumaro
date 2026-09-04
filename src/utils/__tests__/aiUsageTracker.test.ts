/**
 * aiUsageTracker.test.ts
 * aiUsageTracker.ts の単体テスト
 */

import { webcrypto as crypto } from '@peculiar/webcrypto';
Object.defineProperty(global, 'crypto', { value: crypto });

// StorageKeys モック
vi.mock('../storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

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
    checkHardLimit,
    resetCounterLockForTesting,
    setClockForTesting,
    resetClockForTesting
} from '../aiUsageTracker.js';

// Fixed clock for deterministic rate-limit window assertions. The SUT reads
// time only through the injected clock, so window-boundary tests no longer
// depend on real elapsed time under load.
const FIXED_NOW = 1725456000000;

describe('aiUsageTracker', () => {

    beforeEach(() => {
        Object.keys(mockStorage).forEach(key => delete mockStorage[key]);
        vi.clearAllMocks();
        resetCounterLockForTesting();
        resetClockForTesting();
        setClockForTesting(() => FIXED_NOW);
    });

    afterEach(() => {
        resetClockForTesting();
        resetCounterLockForTesting();
        vi.useRealTimers();
    });

    describe('checkRateLimit', () => {
        test('初回は許可される', async () => {
            const result = await checkRateLimit();
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(9);
        });

        test('ウィンドウ内のリクエスト数を追跡する', async () => {
            mockStorage['ai_rate_limit_window_start'] = FIXED_NOW;
            mockStorage['ai_rate_limit_count'] = 5;

            const result = await checkRateLimit();
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(4);
        });

        test('10回以上は拒否される', async () => {
            mockStorage['ai_rate_limit_window_start'] = FIXED_NOW;
            mockStorage['ai_rate_limit_count'] = 10;

            const result = await checkRateLimit();
            expect(result.allowed).toBe(false);
            expect(result.remaining).toBe(0);
        });

        test('ウィンドウ期限切れでリセットされる', async () => {
            // Seeded 61s before the injected clock: expiry is deterministic
            // and independent of real elapsed time under load.
            mockStorage['ai_rate_limit_window_start'] = FIXED_NOW - 61000;
            mockStorage['ai_rate_limit_count'] = 10;

            const result = await checkRateLimit();
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(9);
            // A fresh window starts at the injected clock value.
            expect(mockStorage['ai_rate_limit_window_start']).toBe(FIXED_NOW);
            expect(result.resetTime).toBe(FIXED_NOW + 60000);
        });

        test('ウィンドウ境界内ではリセットされない', async () => {
            // 1s inside the 60s window: still counts against the cap.
            mockStorage['ai_rate_limit_window_start'] = FIXED_NOW - 59000;
            mockStorage['ai_rate_limit_count'] = 10;

            const result = await checkRateLimit();
            expect(result.allowed).toBe(false);
            expect(result.remaining).toBe(0);
            expect(result.resetTime).toBe(FIXED_NOW - 59000 + 60000);
        });

        // VULN-010 (CWE-362): concurrent calls must not lose increments on the
        // read-modify-write of the rate-limit counter. With max=1, exactly one
        // of two concurrent calls may be allowed. Timer-based interleaving uses
        // scoped fake timers so the stretch under load cannot flake.
        test('VULN-010: 同時呼び出しでレート制限を突破できない', async () => {
            vi.useFakeTimers();
            try {
                const origGet = mockChrome.storage.local.get;
                const origSet = mockChrome.storage.local.set;
                const setOrder: unknown[] = [];
                // Force both reads to observe the initial count before either write,
                // reproducing the read-modify-write interleaving.
                mockChrome.storage.local.get = vi.fn(async (keys: any) => {
                    await new Promise<void>(r => setTimeout(r, 5));
                    return origGet(keys);
                });
                mockChrome.storage.local.set = vi.fn(async (data: any) => {
                    await new Promise<void>(r => setTimeout(r, 5));
                    setOrder.push(data['ai_rate_limit_count']);
                    return origSet(data);
                });

                mockStorage['ai_rate_limit_max'] = 1;
                mockStorage['ai_rate_limit_window_start'] = FIXED_NOW;
                mockStorage['ai_rate_limit_count'] = 0;

                const pending = Promise.all([checkRateLimit(), checkRateLimit()]);
                // Each serialized call performs 3 storage ops x 5ms; 100ms
                // covers the full chain deterministically.
                await vi.advanceTimersByTimeAsync(100);
                const [a, b] = await pending;

                mockChrome.storage.local.get = origGet;
                mockChrome.storage.local.set = origSet;

                const allowed = [a, b].filter(r => r.allowed).length;
                expect(allowed).toBe(1);
                // The counter must reflect both increments (reach the cap of 1),
                // not a lost update back to 1.
                expect(mockStorage['ai_rate_limit_count']).toBe(1);
                // Serialization proof: the count write happened exactly once
                // (the denied call wrote nothing), in increment order.
                expect(setOrder).toEqual([1]);
            } finally {
                vi.useRealTimers();
            }
        });

        test('count が undefined の場合は 0 から開始', async () => {
            mockStorage['ai_rate_limit_window_start'] = FIXED_NOW;

            const result = await checkRateLimit();
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(9);
        });

        test('AI_RATE_LIMIT_MAX 設定値を参照する', async () => {
            mockStorage['ai_rate_limit_max'] = 5;
            mockStorage['ai_rate_limit_window_start'] = FIXED_NOW;
            mockStorage['ai_rate_limit_count'] = 5;

            const result = await checkRateLimit();
            expect(result.allowed).toBe(false);
            expect(result.remaining).toBe(0);
        });

        test('AI_RATE_LIMIT_MAX が未設定の場合はデフォルト 10 を使用する', async () => {
            mockStorage['ai_rate_limit_window_start'] = FIXED_NOW;
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
            const message = getRateLimitMessage(FIXED_NOW + 30000);
            expect(message).toContain('Rate limit');
            expect(message).toContain('30 seconds');
        });

        test('秒数を計算する', () => {
            const message = getRateLimitMessage(FIXED_NOW + 5000);
            expect(message).toContain('5 seconds');
        });

        test('残り時間を切り上げで計算する', () => {
            const message = getRateLimitMessage(FIXED_NOW + 5100);
            expect(message).toContain('6 seconds');
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
