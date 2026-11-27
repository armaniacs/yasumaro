/**
 * RateLimitService.ts
 * マスターパスワード認証のレート制限 (ブルートフォース攻撃防止)。
 * Clock / StoragePort を注入することで chrome global mock なしに単体テスト可能にする。
 */

import { SYSTEM_CLOCK, CHROME_STORAGE_PORT, type Clock, type StoragePort, type StorageArea } from './ports.js';
import { StorageTransaction, type CasRetryOptions } from './storage/storageTransaction.js';
import type { StoragePort as TransactionStoragePort } from './storage/storagePort.js';

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
 * Presents one chrome.storage area as the port shape the CAS helpers expect
 * (get/set plus the write-time fence). The fence mirrors storagePort.ts's
 * compareAndSetViaGetSet so the verify->write window is as narrow here as it
 * is for the production ChromeStoragePort.
 */
function transactionPortOverArea(area: StorageArea): TransactionStoragePort {
  return {
    get: async (keys) => {
      const list = keys === null ? [] : Array.isArray(keys) ? keys : [keys];
      return area.get(list) as Promise<Record<string, unknown>>;
    },
    set: (items) => area.set(items),
    compareAndSet: async (items, expectedVersions) => {
      const current = await area.get(Object.keys(expectedVersions));
      for (const [versionKey, expected] of Object.entries(expectedVersions)) {
        const observed = current[versionKey];
        if ((typeof observed === 'number' ? observed : 0) !== expected) return false;
      }
      await area.set(items);
      return true;
    },
  };
}

/**
 * CAS conflicts here resolve in microtasks (the only writers are concurrent
 * calls inside the same service worker), so backoff would only delay the
 * user-facing unlock-flow error return without preventing anything — and
 * tests must never spend wall time on the retry path.
 */
const CAS_RETRY_OPTIONS: CasRetryOptions = { sleep: () => Promise.resolve() };

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

    // CWE-367 hardening (PBI 2026-11-27-08): the increment derives from the
    // value re-read under the CAS lock, so a concurrent recordFailedAttempt
    // can no longer be lost — an undercount would stretch the brute-force
    // budget. The Math.max baseline only covers a pre-existing session>local
    // divergence left by an older crash mid-write; in steady state it equals
    // the stored value. Both writes below still land immediately (no timer):
    // the service worker is ephemeral and a deferred write is never
    // guaranteed to fire (PBI 2026-11-08-09 (6)).
    const tx = new StorageTransaction(transactionPortOverArea(this.storage.local));
    const [nextAttempts, nextFirstAttempt] = await tx.withAtomic<[number, number]>(
      [STORAGE_KEYS.FAILED_ATTEMPTS, STORAGE_KEYS.FIRST_ATTEMPT_TIME],
      ([storedAttempts]) => [Math.max(storedAttempts || 0, attempts) + 1, firstAttempt],
      CAS_RETRY_OPTIONS
    );

    // The session store is a mirror of the CAS-committed local values, not a
    // second CAS writer: checkRateLimit merges the two stores with max(), so
    // a mirror write racing another writer can only read lower and never
    // regress the effective count, while CASing both stores would double-apply
    // an increment whenever one store commits and the other conflicts.
    await this.storage.session.set({
      [STORAGE_KEYS.FAILED_ATTEMPTS]: nextAttempts,
      [STORAGE_KEYS.FIRST_ATTEMPT_TIME]: nextFirstAttempt,
    });
  }

  async resetFailedAttempts(): Promise<void> {
    // The CAS keeps `<key>_version` siblings next to the counters; removing
    // them too gives the next window a clean slate instead of resuming a
    // pre-reset version generation.
    const keys = [
      STORAGE_KEYS.FAILED_ATTEMPTS,
      STORAGE_KEYS.FIRST_ATTEMPT_TIME,
      STORAGE_KEYS.LOCKED_UNTIL,
      `${STORAGE_KEYS.FAILED_ATTEMPTS}_version`,
      `${STORAGE_KEYS.FIRST_ATTEMPT_TIME}_version`,
    ];
    await this.storage.session.remove(keys);
    await this.storage.local.remove(keys);
  }
}
