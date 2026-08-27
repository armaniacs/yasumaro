/**
 * rateLimiter.ts
 * マスターパスワード認証のレート制限モジュール
 * ブルートフォース攻撃防止のための試行回数制限
 *
 * 実体は RateLimitService (Clock + StoragePort 注入可能) に移した。
 * 既存呼び出し元 (masterPassword.ts 等) との互換性のため関数エクスポートを維持する。
 */

import { RateLimitService, type RateLimitResult } from './RateLimitService.js';

export type { RateLimitResult };

const defaultRateLimitService = new RateLimitService();

export async function checkRateLimit(): Promise<RateLimitResult> {
  return defaultRateLimitService.checkRateLimit();
}

export async function recordFailedAttempt(): Promise<void> {
  return defaultRateLimitService.recordFailedAttempt();
}

export async function resetFailedAttempts(): Promise<void> {
  return defaultRateLimitService.resetFailedAttempts();
}
