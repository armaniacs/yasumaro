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

export interface RateLimitResult {
  success: boolean;
  error?: string;
}

export class RateLimitService {
  constructor(
    private readonly clock: Clock = SYSTEM_CLOCK,
    private readonly storage: StoragePort = CHROME_STORAGE_PORT
  ) {}

  async checkRateLimit(): Promise<RateLimitResult> {
    const sessionStorage = await this.storage.session.get<Record<string, number>>([
      STORAGE_KEYS.FAILED_ATTEMPTS,
      STORAGE_KEYS.FIRST_ATTEMPT_TIME,
      STORAGE_KEYS.LOCKED_UNTIL,
    ]);
    const localStorage =
      (await this.storage.local.get<Record<string, number>>([
        STORAGE_KEYS.FAILED_ATTEMPTS,
        STORAGE_KEYS.FIRST_ATTEMPT_TIME,
        STORAGE_KEYS.LOCKED_UNTIL,
      ])) || {};

    // M3: persist failedAttempts to local so session clear does not reset.
    // Take max of both stores (attacker clearing session leaves local value).
    const attempts = Math.max(
      sessionStorage[STORAGE_KEYS.FAILED_ATTEMPTS] || 0,
      localStorage[STORAGE_KEYS.FAILED_ATTEMPTS] || 0
    );
    // First attempt time: earliest non-zero value across stores (keeps window tight).
    const sessionFirst = sessionStorage[STORAGE_KEYS.FIRST_ATTEMPT_TIME] || 0;
    const localFirst = localStorage[STORAGE_KEYS.FIRST_ATTEMPT_TIME] || 0;
    const firstAttemptCandidates = [sessionFirst, localFirst].filter(v => v > 0);
    const effectiveFirstAttempt = firstAttemptCandidates.length > 0 ? Math.min(...firstAttemptCandidates) : 0;

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
    const sessionData = await this.storage.session.get<Record<string, number>>([
      STORAGE_KEYS.FAILED_ATTEMPTS,
      STORAGE_KEYS.FIRST_ATTEMPT_TIME,
    ]);
    const localData =
      (await this.storage.local.get<Record<string, number>>([
        STORAGE_KEYS.FAILED_ATTEMPTS,
        STORAGE_KEYS.FIRST_ATTEMPT_TIME,
      ])) || {};

    const sessionAttempts = sessionData[STORAGE_KEYS.FAILED_ATTEMPTS] || 0;
    const localAttempts = localData[STORAGE_KEYS.FAILED_ATTEMPTS] || 0;
    const attempts = Math.max(sessionAttempts, localAttempts);
    const sessionFirst = sessionData[STORAGE_KEYS.FIRST_ATTEMPT_TIME] || 0;
    const localFirst = localData[STORAGE_KEYS.FIRST_ATTEMPT_TIME] || 0;
    const firstAttemptCandidates = [sessionFirst, localFirst].filter(v => v > 0);
    const firstAttempt =
      firstAttemptCandidates.length > 0 ? Math.min(...firstAttemptCandidates) : this.clock.now();

    const nextAttempts = attempts + 1;
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
