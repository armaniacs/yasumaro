/**
 * RateLimitService.ts
 * マスターパスワード認証のレート制限 (ブルートフォース攻撃防止)。
 * Clock / StoragePort を注入することで chrome global mock なしに単体テスト可能にする。
 */

import { SYSTEM_CLOCK, CHROME_STORAGE_PORT, type Clock, type StoragePort } from './ports.js';

const RATE_LIMIT_ATTEMPTS = 5; // 5分以内の最大試行回数
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 評価ウインドウ: 5分
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // ロックアウト期間: 30分
const LOCKOUT_DURATION_MINUTES = 30;

const STORAGE_KEYS = {
  FAILED_ATTEMPTS: 'passwordFailedAttempts',
  FIRST_ATTEMPT_TIME: 'firstFailedAttemptTime',
  LOCKED_UNTIL: 'lockedUntil',
} as const;

/**
 * Former coalescing window for recordFailedAttempt writes (PBI-17).
 *
 * Kept as a deprecated export for compatibility: writes are now persisted
 * immediately (PBI 2026-11-08-09 (6)) because the Service Worker is ephemeral
 * and a deferred timer write is never guaranteed to fire — sub-threshold
 * failures kept only behind this timer vanished on SW shutdown and were
 * undercounted, letting an attacker stretch the brute-force budget.
 * Batching saved at most a handful of writes per 5-minute window, which is
 * negligible next to a lockout bypass.
 *
 * @deprecated Writes are immediate; the value is unused by the service.
 */
export const RATE_LIMIT_WRITE_COALESCE_MS = 300;

export interface RateLimitResult {
  success: boolean;
  error?: string;
}

export class RateLimitService {
  constructor(
    private readonly clock: Clock = SYSTEM_CLOCK,
    private readonly storage: StoragePort = CHROME_STORAGE_PORT
  ) {}

  /**
   * 保留中のカウンタ書き込みを両ストアへ即時反映する。
   * 書き込みは recordFailedAttempt で即時永続化されるため通常は保留がなく
   * 何もしない。rateLimiter.flushRateLimitWrites との互換のために残す。
   */
  async flushPendingWrites(): Promise<void> {
    return;
  }

  private async readCounters(
    extraKeys: readonly string[] = []
  ): Promise<{ sessionData: Record<string, number>; localData: Record<string, number> }> {
    const keys = [STORAGE_KEYS.FAILED_ATTEMPTS, STORAGE_KEYS.FIRST_ATTEMPT_TIME, ...extraKeys];
    const sessionData = await this.storage.session.get<Record<string, number>>(keys);
    const localData = (await this.storage.local.get<Record<string, number>>(keys)) || {};
    return {
      sessionData: sessionData as Record<string, number>,
      localData: localData as Record<string, number>,
    };
  }

  private mergeCounters(
    sessionData: Record<string, number>,
    localData: Record<string, number>,
    fallbackFirstAttempt: number
  ): { attempts: number; effectiveFirstAttempt: number } {
    const attempts = Math.max(
      sessionData[STORAGE_KEYS.FAILED_ATTEMPTS] || 0,
      localData[STORAGE_KEYS.FAILED_ATTEMPTS] || 0
    );
    const sessionFirst = sessionData[STORAGE_KEYS.FIRST_ATTEMPT_TIME] || 0;
    const localFirst = localData[STORAGE_KEYS.FIRST_ATTEMPT_TIME] || 0;
    const firstAttemptCandidates = [sessionFirst, localFirst].filter(v => v > 0);
    const effectiveFirstAttempt =
      firstAttemptCandidates.length > 0 ? Math.min(...firstAttemptCandidates) : fallbackFirstAttempt;
    return { attempts, effectiveFirstAttempt };
  }

  async checkRateLimit(): Promise<RateLimitResult> {
    const { sessionData: sessionStorage, localData: localStorage } = await this.readCounters([
      STORAGE_KEYS.LOCKED_UNTIL,
    ]);
    const { attempts, effectiveFirstAttempt } = this.mergeCounters(sessionStorage, localStorage, 0);

    const sessionLockedUntil = sessionStorage[STORAGE_KEYS.LOCKED_UNTIL] || 0;
    const localLockedUntil = localStorage[STORAGE_KEYS.LOCKED_UNTIL] || 0;
    // NTP skew mitigation: session and local storage can drift out of sync
    // (e.g. session cleared on browser restart while local persists), so the
    // larger of the two lock timestamps always wins.
    const lockedUntil = Math.max(sessionLockedUntil, localLockedUntil);
    const now = this.clock.now();

    if (lockedUntil && now < lockedUntil) {
      const remainingMinutes = Math.ceil((lockedUntil - now) / (60 * 1000));
      return {
        success: false,
        error: `Too many attempts. Please try again in ${remainingMinutes} minutes.`,
      };
    }

    if (attempts >= RATE_LIMIT_ATTEMPTS) {
      const firstAttempt = effectiveFirstAttempt || now;

      if (now - firstAttempt > RATE_LIMIT_WINDOW_MS) {
        await this.resetFailedAttempts();
      } else {
        const lockoutTime = now + LOCKOUT_DURATION_MS;
        // Write both stores so the lock survives whichever one is later read
        // as authoritative (see NTP skew mitigation above).
        await this.storage.local.set({ [STORAGE_KEYS.LOCKED_UNTIL]: lockoutTime });
        await this.storage.session.set({ [STORAGE_KEYS.LOCKED_UNTIL]: lockoutTime });
        return {
          success: false,
          error: `Too many attempts. Please try again in ${LOCKOUT_DURATION_MINUTES} minutes.`,
        };
      }
    }

    return { success: true };
  }

  async recordFailedAttempt(): Promise<void> {
    const { sessionData, localData } = await this.readCounters();
    const { attempts, effectiveFirstAttempt: firstAttempt } = this.mergeCounters(
      sessionData,
      localData,
      this.clock.now()
    );

    const nextAttempts = attempts + 1;
    // SW-ephemerality fix (PBI 2026-11-08-09 (6)): persist every failure to
    // both stores immediately. A coalesced timer write is never guaranteed to
    // fire before SW shutdown, so sub-threshold failures lived only in memory
    // and vanished on restart (undercount -> lockout bypass). Every failure
    // is security-relevant; the batching saved only a few writes per window.
    await this.storage.session.set({
      [STORAGE_KEYS.FAILED_ATTEMPTS]: nextAttempts,
      [STORAGE_KEYS.FIRST_ATTEMPT_TIME]: firstAttempt,
    });
    await this.storage.local.set({
      [STORAGE_KEYS.FAILED_ATTEMPTS]: nextAttempts,
      [STORAGE_KEYS.FIRST_ATTEMPT_TIME]: firstAttempt,
    });
  }

  async resetFailedAttempts(): Promise<void> {
    await this.storage.session.remove([
      STORAGE_KEYS.FAILED_ATTEMPTS,
      STORAGE_KEYS.FIRST_ATTEMPT_TIME,
      STORAGE_KEYS.LOCKED_UNTIL,
    ]);
    await this.storage.local.remove([
      STORAGE_KEYS.FAILED_ATTEMPTS,
      STORAGE_KEYS.FIRST_ATTEMPT_TIME,
      STORAGE_KEYS.LOCKED_UNTIL,
    ]);
  }
}
