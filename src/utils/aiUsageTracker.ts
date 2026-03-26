/**
 * aiUsageTracker.ts
 * AI使用状況トラッキング・レート制限管理
 */

import { StorageKeys } from './storage.js';
import { addLog, LogType } from './logger.js';

// レート制限設定
const RATE_LIMIT_WINDOW_MS = 60000; // 1分
const RATE_LIMIT_MAX_REQUESTS = 10; // 1分間に最大10リクエスト

/**
 * レート制限チェック
 * @returns {Promise<{allowed: boolean; remaining: number; resetTime: number}>}
 */
export async function checkRateLimit(): Promise<{
  allowed: boolean;
  remaining: number;
  resetTime: number;
}> {
  const now = Date.now();

  const result = await chrome.storage.local.get([
    StorageKeys.AI_RATE_LIMIT_WINDOW_START,
    StorageKeys.AI_RATE_LIMIT_COUNT
  ]);

  const windowStart = result[StorageKeys.AI_RATE_LIMIT_WINDOW_START] as number | undefined;
  let count = result[StorageKeys.AI_RATE_LIMIT_COUNT] as number | undefined;

  // ウィンドウがリセットされるか、新規ウィンドウ
  if (!windowStart || now - windowStart > RATE_LIMIT_WINDOW_MS) {
    await chrome.storage.local.set({
      [StorageKeys.AI_RATE_LIMIT_WINDOW_START]: now,
      [StorageKeys.AI_RATE_LIMIT_COUNT]: 0
    });
    return {
      allowed: true,
      remaining: RATE_LIMIT_MAX_REQUESTS - 1,
      resetTime: now + RATE_LIMIT_WINDOW_MS
    };
  }

  // カウントがない場合は初期化
  if (count === undefined) {
    count = 0;
  }

  // レート制限チェック
  if (count >= RATE_LIMIT_MAX_REQUESTS) {
    addLog(LogType.WARN, 'AI rate limit exceeded', {
      count,
      limit: RATE_LIMIT_MAX_REQUESTS,
      resetIn: Math.ceil((windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000)
    });
    return {
      allowed: false,
      remaining: 0,
      resetTime: windowStart + RATE_LIMIT_WINDOW_MS
    };
  }

  // カウント増加
  await chrome.storage.local.set({
    [StorageKeys.AI_RATE_LIMIT_COUNT]: count + 1
  });

  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX_REQUESTS - count - 1,
    resetTime: windowStart + RATE_LIMIT_WINDOW_MS
  };
}

/**
 * 月次使用状況を取得
 */
export interface AIUsageStats {
  month: string;
  tokensSent: number;
  tokensReceived: number;
  requestCount: number;
}

/**
 * 現在の月を取得（YYYY-MM形式）
 */
function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * 月次使用状況を取得
 */
export async function getMonthlyUsage(): Promise<AIUsageStats> {
  const result = await chrome.storage.local.get([
    StorageKeys.AI_USAGE_MONTH,
    StorageKeys.AI_USAGE_TOKENS_SENT,
    StorageKeys.AI_USAGE_TOKENS_RECEIVED,
    StorageKeys.AI_USAGE_REQUEST_COUNT
  ]);

  const storedMonth = result[StorageKeys.AI_USAGE_MONTH] as string | undefined;
  const currentMonth = getCurrentMonth();

  // 月が変わった場合はリセット
  if (storedMonth !== currentMonth) {
    await resetMonthlyUsage();
    return {
      month: currentMonth,
      tokensSent: 0,
      tokensReceived: 0,
      requestCount: 0
    };
  }

  return {
    month: storedMonth || currentMonth,
    tokensSent: result[StorageKeys.AI_USAGE_TOKENS_SENT] as number || 0,
    tokensReceived: result[StorageKeys.AI_USAGE_TOKENS_RECEIVED] as number || 0,
    requestCount: result[StorageKeys.AI_USAGE_REQUEST_COUNT] as number || 0
  };
}

/**
 * 月次使用状況をリセット
 */
async function resetMonthlyUsage(): Promise<void> {
  const currentMonth = getCurrentMonth();
  await chrome.storage.local.set({
    [StorageKeys.AI_USAGE_MONTH]: currentMonth,
    [StorageKeys.AI_USAGE_TOKENS_SENT]: 0,
    [StorageKeys.AI_USAGE_TOKENS_RECEIVED]: 0,
    [StorageKeys.AI_USAGE_REQUEST_COUNT]: 0
  });
}

/**
 * 使用量を記録
 */
export async function recordUsage(
  tokensSent: number,
  tokensReceived: number
): Promise<void> {
  const usage = await getMonthlyUsage();

  await chrome.storage.local.set({
    [StorageKeys.AI_USAGE_TOKENS_SENT]: usage.tokensSent + tokensSent,
    [StorageKeys.AI_USAGE_TOKENS_RECEIVED]: usage.tokensReceived + tokensReceived,
    [StorageKeys.AI_USAGE_REQUEST_COUNT]: usage.requestCount + 1
  });
}

/**
 * レート制限警告メッセージを取得
 */
export function getRateLimitMessage(resetTime: number): string {
  const seconds = Math.ceil((resetTime - Date.now()) / 1000);
  return `Rate limit exceeded. Please wait ${seconds} seconds.`;
}

/**
 * 使用量警告をチェック（月間100万トークンを想定）
 */
export async function checkUsageWarning(): Promise<{
  warning: boolean;
  message?: string;
}> {
  const usage = await getMonthlyUsage();
  const totalTokens = usage.tokensSent + usage.tokensReceived;
  const MONTHLY_WARNING_THRESHOLD = 1000000; // 100万トークン

  if (totalTokens > MONTHLY_WARNING_THRESHOLD) {
    return {
      warning: true,
      message: `Monthly token usage (${totalTokens.toLocaleString()}) has exceeded ${MONTHLY_WARNING_THRESHOLD.toLocaleString()}`
    };
  }

  return { warning: false };
}
