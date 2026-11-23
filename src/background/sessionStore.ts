import { LogType } from '../utils/logger/types.js';
import { addLog } from '../utils/logger/core.js';
import { errorMessage } from '../utils/errorUtils.js';
import { ChromeStoragePort, type StoragePort } from '../utils/storage/storagePort.js';

export const SESSION_KEYS = {
  SKIP_AI_RATE_LIMITER: 'sw:rateLimiter',
  TAB_CACHE: 'sw:tabCache',
  RECORDING_CACHE: 'sw:recordingCache',
  /** PBI 27-03: AI provider circuit-breaker state (provider × model entries). */
  AI_PROVIDER_BREAKER: 'sw:aiProviderBreaker',
} as const;

/**
 * Thrown by get() when the session read itself fails. A miss resolves to
 * null; a failure rejects with this error, so callers can tell "no value"
 * apart from "could not read" instead of both collapsing to null.
 */
export class SessionStoreReadError extends Error {
  readonly key: string;
  readonly causeText: string;

  constructor(key: string, causeText: string) {
    super(`SessionStore: failed to read key "${key}": ${causeText}`);
    this.name = 'SessionStoreReadError';
    this.key = key;
    this.causeText = causeText;
  }
}

/**
 * Outcome of the single-key local-to-session fallback migration.
 *
 * - 'migrated': the key moved from local to session storage.
 * - 'absent': local storage definitively has no such key (safe to memoize).
 * - 'failed': a transient error (logged inside); the caller must NOT memoize
 *   this outcome so the next read retries the migration.
 */
export type LocalFallbackOutcome = 'migrated' | 'absent' | 'failed';

/**
 * Last suspend-backup attempt recorded by emergencyFlushToLocal, so the
 * fire-and-forget onSuspend path stays observable after the fact.
 */
export interface SuspendBackupStatus {
  at: number;
  keys: string[];
  ok: boolean;
}

/**
 * SessionStore の依存先向け最小契約。
 *
 * get() は miss に対して null を返し、読み取り失敗に対しては
 * SessionStoreReadError を投げる（「値なし」と「読み取り失敗」を区別できる）。
 * set() のデフォルトは debounce 書き込みだが、未 flush のキューは
 * onSuspend 時に local へ自動退避され、起動時・get 時に移行で復元される。
 * 即時性が要る書き込みは { flushImmediately: true } を指定すること。
 *
 * @throws {SessionStoreReadError} get() が chrome.storage.session の読み取り
 *   失敗時（および local フォールバック移行後の再読み取り失敗時）に投げる。
 *   miss は null で返るため、呼び出し側は catch しなくても「値なし」を
 *   通常フローで扱える。set()/remove() はキュー投入のみで投げない。
 *   具象 SessionStore.waitForFlush() は未処理キューが
 *   MAX_WAIT_FOR_FLUSH_ROUNDS を超えて残る場合に Error を投げる
 *   (Port 契約外の拡張であり、この Port 型経由では呼ばないこと)。
 */
export interface SessionStorePort {
  /** miss は null、読み取り失敗は SessionStoreReadError を投げる。 */
  get<T>(key: string): Promise<T | null>;
  /** キュー投入のみで投げない。flush 失敗は内部で再試行・退避される。 */
  set(key: string, value: unknown, options?: { flushImmediately?: boolean }): Promise<void>;
  /** キュー投入のみで投げない。 */
  remove(key: string): void;
}

/**
 * Debounce window for timer-based flushes. Exported so tests can cross it on a
 * fake clock instead of hardcoding a delay that silently drifts from this value.
 */
export const SESSION_STORE_FLUSH_DELAY_MS = 50;

/**
 * Byte cap for one chrome.storage.session write. The previous 1 MiB cap cut
 * legitimate payloads: MAX_URL_SET_SIZE bounds the entry *count*, not its bytes,
 * so 10,000 x 180-char [url, timestamp] entries serialize to ~2 MB and were
 * reduced on every flush. 3 MiB covers 10,000 entries up to 293-char URLs and
 * keeps the 10 MiB session quota at 35% (69% under a UTF-16 upper bound);
 * 4 MiB reaches 89% and 5 MiB exceeds the quota. Measured sizes and the
 * rejected alternatives: dev-docs/ADR/2026-09-28-session-store-overflow-persistence.md
 * (decisions 1-2, lines 156-172).
 */
export const SESSION_MAX_FLUSH_BYTES = 3 * 1024 * 1024;

/**
 * How often one key may be re-queued for exceeding SESSION_MAX_FLUSH_BYTES
 * before the next overflow flush drops it from the memory queue. Unbounded
 * re-queueing is the state this guards: a key too large for the cap is
 * re-queued at the same size on every flush forever, re-serializing the whole
 * queue each time and copying itself to chrome.storage.local on every
 * service-worker suspend. Bounding the retries makes that loop impossible
 * rather than merely unlikely (same ADR, decision 2). The full value is
 * backed up to local storage on the first overflow and again on the drop, so
 * the bound never means silent loss — only the in-memory retry stops.
 */
const MAX_OVERFLOW_REQUEUES = 2;

/**
 * How often a quota-exceeded batch is retried before its items leave the
 * memory queue. Like the overflow bound, this only stops the in-memory
 * retry: on exhaustion the full values are backed up to local storage and
 * the drop is logged, so the data stays recoverable through the normal
 * local-to-session migration instead of idling until the next set().
 */
const MAX_QUOTA_RETRIES = 3;

/**
 * Upper bound for waitForFlush's settle loop. Each round awaits real flush
 * work (no spinning); hitting the bound means a producer keeps the queue
 * non-empty forever, which is logged and returned from instead of hanging.
 */
const MAX_WAIT_FOR_FLUSH_ROUNDS = 100;

/**
 * Local-area backend contract for SessionStore's chrome.storage.local paths
 * (emergency flush, single-key and startup migrations). Same shape as
 * StoragePort, but `remove` is required: the migration paths always clean up
 * the local keys they move. Both production ports (ChromeStoragePort,
 * InMemoryStoragePort) satisfy it.
 */
export type SessionLocalPort = Pick<StoragePort, 'get' | 'set'> & {
  remove(keys: string | string[]): Promise<void>;
};

/**
 * Production local-area backend. Module-level singleton: ChromeStoragePort
 * is stateless and touches chrome lazily per call, so sharing it changes
 * neither timing nor behavior.
 */
const sharedLocalPort: SessionLocalPort = new ChromeStoragePort();

export class SessionStore implements SessionStorePort {
  private writeQueue = new Map<string, unknown>();
  private deleteQueue = new Set<string>();
  private flushPromise: Promise<void> | null = null;
  private flushQueue: Promise<void>[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushToken = 0;
  private disposed = false;
  /**
   * Keys whose local fallback check finished definitively ('migrated' or
   * 'absent'). A 'failed' (transient) outcome is deliberately NOT memoized,
   * so the next get() retries the migration instead of suppressing a
   * legitimate move forever.
   */
  private localFallbackCheckedKeys = new Set<string>();
  /**
   * Consecutive overflow re-queues per key, kept apart from writeQueue so the
   * queue's own key set stays intact. In-memory only: a service-worker restart
   * resets the counts, which is accepted because "a key leaves the queue within
   * MAX_OVERFLOW_REQUEUES + 1 overflow flushes" holds for every lifetime.
   * Persisting the counts would add a chrome.storage.session key.
   */
  private overflowRequeueCounts = new Map<string, number>();
  /**
   * Consecutive quota-exceeded flushes per key. Same in-memory-only rationale
   * as overflowRequeueCounts: the bound that matters is per lifetime, and the
   * values themselves are durably backed up on exhaustion.
   */
  private quotaRetryCounts = new Map<string, number>();
  private suspendHandlerRegistered = false;
  private lastSuspendBackup: SuspendBackupStatus | null = null;

  // フラッシュ間隔（ミリ秒）- マイクロタスクより少し遅らせるが、まだ応答性を保つ
  private readonly FLUSH_DELAY = SESSION_STORE_FLUSH_DELAY_MS;

  constructor(private readonly localPort: SessionLocalPort = sharedLocalPort) {
    // Debounced set() writes must not depend on callers remembering the
    // suspend wiring: register the emergency local backup automatically.
    // Idempotent per store, so the explicit service-worker registration stays
    // a harmless no-op.
    SessionStore.registerSuspendHandler(this);
  }

  async get<T>(key: string): Promise<T | null> {
    if (!chrome?.storage?.session) {
      throw new SessionStoreReadError(key, 'chrome.storage.session is unavailable');
    }
    let result: Record<string, unknown>;
    try {
      result = (await chrome.storage.session.get(key)) as Record<string, unknown>;
    } catch (error) {
      throw new SessionStoreReadError(key, errorMessage(error));
    }
    if (key in result) {
      return result[key] as T;
    }
    // session にデータがない場合、local からのフォールバック移行を試す
    if (!this.localFallbackCheckedKeys.has(key)) {
      let outcome: LocalFallbackOutcome = 'failed';
      try {
        outcome = await SessionStore.migrateFromLocalStorageIfSessionEmpty(key, this.localPort);
      } catch (error) {
        // A custom port may throw outside the migration's own handling;
        // treat it as transient: log visibly, retry on the next get().
        addLog(LogType.WARN, 'SessionStore: local fallback check failed transiently, will retry on next read', {
          key,
          error: errorMessage(error),
        });
      }
      if (outcome === 'migrated') {
        this.localFallbackCheckedKeys.add(key);
        let fallbackResult: Record<string, unknown>;
        try {
          fallbackResult = (await chrome.storage.session.get(key)) as Record<string, unknown>;
        } catch (error) {
          throw new SessionStoreReadError(key, errorMessage(error));
        }
        return (fallbackResult[key] as T) ?? null;
      }
      if (outcome === 'absent') {
        this.localFallbackCheckedKeys.add(key);
      }
      // 'failed' stays unmemoized so the next get() retries the migration.
    }
    return null;
  }

  /**
   * Queue a write for a key. By default the flush is debounced; pass
   * `{ flushImmediately: true }` for writes that must not wait for the
   * debounce window. Debounced writes are still protected: the suspend
   * handler backs them up to local storage automatically, and quota/overflow
   * failures are retried (bounded) then backed up instead of dropped
   * silently.
   */
  async set(key: string, value: unknown, options?: { flushImmediately?: boolean }): Promise<void> {
    if (this.disposed) return;
    this.writeQueue.set(key, value);
    this.deleteQueue.delete(key);
    if (options?.flushImmediately) {
      await this.flushNow();
    } else {
      this.scheduleFlush();
    }
  }

  remove(key: string): void {
    if (this.disposed) return;
    this.writeQueue.delete(key);
    this.overflowRequeueCounts.delete(key);
    this.quotaRetryCounts.delete(key);
    this.deleteQueue.add(key);
    this.scheduleFlush();
  }

  // 重要な操作後に即座にフラッシュしたい場合のメソッド
  async flushNow(): Promise<void> {
    if (this.disposed) return;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    // Cancel any pending timer-based flush and run immediately under a new token.
    this.flushToken++;
    await this.flush();
  }

  /**
   * Dispose the store: cancel pending timers and drop queued work.
   * Useful for test cleanup where pending timers could leak into the next test.
   */
  dispose(): void {
    this.disposed = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.writeQueue.clear();
    this.deleteQueue.clear();
    this.overflowRequeueCounts.clear();
    this.quotaRetryCounts.clear();
    this.flushPromise = null;
    this.flushQueue.length = 0;
    this.localFallbackCheckedKeys.clear();
  }

  private scheduleFlush(): void {
    if (this.disposed) return;
    // 既にフラッシュがスケジュールまたは実行中の場合は何もしない
    if (this.flushPromise || this.flushTimer) return;

    // タイマーベースのフラッシュをスケジュール
    this.flushToken++;
    const token = this.flushToken;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      // Guard against stale timers in environments where clearTimeout may be
      // unreliable or the callback was already queued.
      if (this.disposed || this.flushToken !== token) return;
      this.flush();
    }, this.FLUSH_DELAY);
  }

  private async flush(): Promise<void> {
    if (this.disposed) return;

    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    this.flushQueue.push(promise);

    if (this.flushPromise) {
      await this.flushPromise;
      this.removeFromFlushQueue(promise);
      resolve();
      if (!this.disposed && (this.writeQueue.size > 0 || this.deleteQueue.size > 0)) {
        await this.flush();
      }
      return;
    }

    this.flushPromise = promise;

    let items = new Map<string, unknown>();
    let keysToDelete = new Set<string>();
    let shouldRetry = false;

    try {
      if (this.writeQueue.size === 0 && this.deleteQueue.size === 0) {
        return;
      }

      if (!chrome?.storage?.session) {
        // The session backend is gone: restore everything and retry on the
        // timer instead of dropping queued work silently.
        addLog(LogType.WARN, 'SessionStore: session storage unavailable, keeping queued writes for retry', {
          keys: [...this.writeQueue.keys()],
        });
        shouldRetry = true;
        return;
      }

      items = new Map(this.writeQueue);
      keysToDelete = new Set(this.deleteQueue);
      this.writeQueue.clear();
      this.deleteQueue.clear();

      if (items.size > 0) {
        const obj: Record<string, unknown> = {};
        for (const [key, value] of items) {
          obj[key] = value;
        }

        const estimatedSize = this.estimateStorageSize(obj);
        if (estimatedSize > SESSION_MAX_FLUSH_BYTES) {
          await this.flushOverCapBatch(items, estimatedSize);
        } else {
          await chrome.storage.session.set(obj);
          for (const key of items.keys()) {
            this.overflowRequeueCounts.delete(key);
            this.quotaRetryCounts.delete(key);
          }
        }
      }
      if (keysToDelete.size > 0) {
        await chrome.storage.session.remove(Array.from(keysToDelete));
      }
    } catch (error) {
      // chrome.storage.session unavailable or quota exceeded
      if (isQuotaError(error)) {
        await this.handleQuotaExceeded(items, keysToDelete);
        // handleQuotaExceeded restores or durably backs up, then decides below.
        shouldRetry = this.writeQueue.size > 0;
        return;
      }

      // フラッシュに失敗した場合はキューに戻してリトライ
      for (const [key, value] of items) {
        this.writeQueue.set(key, value);
      }
      for (const key of keysToDelete) {
        this.deleteQueue.add(key);
      }
      shouldRetry = true;
      return;
    } finally {
      this.flushPromise = null;
      this.removeFromFlushQueue(promise);
      resolve();
      if (shouldRetry || this.writeQueue.size > 0 || this.deleteQueue.size > 0) {
        this.scheduleFlush();
      }
    }
  }

  /**
   * Overflow path: never persist a reduced ("priority sub-keys only") shape
   * under the canonical key — a half-shape that reads back as legitimate data
   * is worse than no write. Instead the full values stay queued for a bounded
   * number of retries, a durable copy goes to local storage (recoverable via
   * the normal migration), and any stale session copy is removed so readers
   * cannot mistake it for the latest write.
   */
  private async flushOverCapBatch(items: Map<string, unknown>, estimatedSize: number): Promise<void> {
    addLog(LogType.WARN, `SessionStore: estimated flush size ${estimatedSize} exceeds cap ${SESSION_MAX_FLUSH_BYTES}, keeping full payload queued with a local backup instead of a partial write`, {
      estimatedSize,
      cap: SESSION_MAX_FLUSH_BYTES,
      keys: Array.from(items.keys()),
    });
    for (const [key, value] of items) {
      const consecutiveOverflowFlushes = (this.overflowRequeueCounts.get(key) ?? 0) + 1;
      if (consecutiveOverflowFlushes > MAX_OVERFLOW_REQUEUES) {
        this.overflowRequeueCounts.delete(key);
        const backedUp = await this.backupItemsToLocal({ [key]: value }, 'overflow-drop');
        addLog(
          backedUp ? LogType.WARN : LogType.ERROR,
          'SessionStore: dropping key that stayed over the flush cap',
          {
            key,
            consecutiveOverflowFlushes,
            estimatedSize,
            backedUp,
          },
        );
        continue;
      }
      this.overflowRequeueCounts.set(key, consecutiveOverflowFlushes);
      this.quotaRetryCounts.delete(key);
      this.writeQueue.set(key, value);
      if (consecutiveOverflowFlushes === 1) {
        // Durable copy before the retry window: a service-worker death
        // mid-requeue must not lose the full value.
        await this.backupItemsToLocal({ [key]: value }, 'overflow');
      }
    }
    // Drop the stale session copy so a half-shape can never read back as
    // canonical. Readers miss, then recover the fresh full value from the
    // local backup through the fallback migration.
    //
    // S18 premise: if this remove fails, the stale copy stays readable and a
    // reader mistakes it for the latest write (no freshness marker exists on
    // the session copy). That window is accepted and bounded, not ignored:
    // the WARN below names the keys for diagnosis; re-queued keys retry this
    // remove on the next flush; dropped keys already have their full value in
    // the local backup (recoverable after the stale copy is eventually
    // evicted). The residual risk is a persistently failing remove coinciding
    // with a drop — visible in the log, never silent.
    try {
      await chrome.storage.session.remove(Array.from(items.keys()));
    } catch (error) {
      addLog(LogType.WARN, 'SessionStore: failed to remove stale over-cap keys from session storage', {
        keys: Array.from(items.keys()),
        error: errorMessage(error),
      });
    }
  }

  /**
   * Quota path: restore the batch and retry on the timer (bounded), so the
   * data is never left idling until the next set(). Once the retry budget is
   * exhausted the full values are backed up to local storage and the drop is
   * logged — recoverable and visible instead of floating in memory until the
   * service worker dies with it.
   */
  private async handleQuotaExceeded(items: Map<string, unknown>, keysToDelete: Set<string>): Promise<void> {
    for (const [key, value] of items) {
      this.writeQueue.set(key, value);
      this.overflowRequeueCounts.delete(key);
    }
    for (const key of keysToDelete) {
      this.deleteQueue.add(key);
    }
    let consecutiveQuotaFlushes = items.size === 0 ? 1 : 0;
    for (const key of items.keys()) {
      consecutiveQuotaFlushes = Math.max(consecutiveQuotaFlushes, (this.quotaRetryCounts.get(key) ?? 0) + 1);
    }
    for (const key of items.keys()) {
      this.quotaRetryCounts.set(key, consecutiveQuotaFlushes);
    }
    if (consecutiveQuotaFlushes > MAX_QUOTA_RETRIES) {
      const dropped: Record<string, unknown> = {};
      for (const [key, value] of items) {
        dropped[key] = value;
        this.quotaRetryCounts.delete(key);
        this.writeQueue.delete(key);
      }
      const backedUp = items.size === 0 ? true : await this.backupItemsToLocal(dropped, 'quota-drop');
      addLog(
        backedUp ? LogType.WARN : LogType.ERROR,
        'SessionStore: session storage quota exceeded persistently, dropping queued items after local backup',
        {
          keys: Array.from(items.keys()),
          consecutiveQuotaFlushes,
          backedUp,
        },
      );
      return;
    }
    addLog(LogType.WARN, 'SessionStore: session storage quota exceeded, keeping data queued and retrying', {
      keys: Array.from(items.keys()),
      attempt: consecutiveQuotaFlushes,
    });
  }

  /**
   * Best-effort durable copy of unflushed values to local storage. Returns
   * whether the copy landed; both outcomes are logged so a lost backup never
   * passes silently.
   */
  private async backupItemsToLocal(items: Record<string, unknown>, reason: string): Promise<boolean> {
    const keys = Object.keys(items);
    if (keys.length === 0) return true;
    // No chrome guard here on purpose: an explicitly injected port (e.g. an
    // in-memory test double) must work without chrome.storage.local, while a
    // missing backend for the shared port surfaces as a caught failure below.
    try {
      await this.localPort.set(items);
    } catch (error) {
      addLog(LogType.WARN, 'SessionStore: backup of unflushed data to local storage failed', {
        keys,
        reason,
        error: errorMessage(error),
      });
      return false;
    }
    addLog(LogType.INFO, 'SessionStore: backed up unflushed data to local storage', {
      keys,
      reason,
    });
    return true;
  }

  private removeFromFlushQueue(promise: Promise<void>): void {
    const index = this.flushQueue.indexOf(promise);
    if (index >= 0) {
      this.flushQueue.splice(index, 1);
    }
  }

  private estimateStorageSize(value: unknown): number {
    try {
      return new Blob([JSON.stringify(value)]).size;
    } catch {
      return 0;
    }
  }

  async waitForFlush(): Promise<void> {
    if (this.disposed) return;
    // Loop until quiescent: a write that lands mid-flush leaves a fresh timer
    // behind, and awaiting only the in-flight flush would miss it. Each round
    // awaits real work, so this never spins.
    //
    // The bound is fail-closed, not fail-silent: hitting it means a producer
    // keeps the queue non-empty forever (a leak, not a slow flush), so the
    // caller learns it via a throw instead of a normal return that looks
    // like "settled". The void return stays compatible: every settled wait
    // still resolves to undefined.
    for (let round = 0; round < MAX_WAIT_FOR_FLUSH_ROUNDS; round++) {
      if (this.disposed) return;
      // スケジュールされたタイマーがあれば即座にフラッシュして待つ
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
        await this.flush();
        continue;
      }
      // 実行中または待機中のフラッシュがあればすべて完了するのを待つ
      if (this.flushQueue.length > 0) {
        await Promise.all([...this.flushQueue]);
        continue;
      }
      return;
    }
    addLog(LogType.ERROR, 'SessionStore: waitForFlush left with unsettled work', {
      rounds: MAX_WAIT_FOR_FLUSH_ROUNDS,
    });
    throw new Error(
      `SessionStore: waitForFlush exceeded ${MAX_WAIT_FOR_FLUSH_ROUNDS} rounds with unsettled work`,
    );
  }

  static mapToEntries<K, V>(map: Map<K, V>): [K, V][] {
    return Array.from(map.entries());
  }

  static entriesToMap<K, V>(entries: [K, V][]): Map<K, V> {
    return new Map(entries);
  }

  /**
   * Register a chrome.runtime.onSuspend listener that writes any unflushed
   * queued data to chrome.storage.local as an emergency backup. Idempotent
   * per store (the constructor already registers), and the attempt outcome
   * is recorded — see emergencyFlushToLocal and getLastSuspendBackup — so a
   * suspend backup never ends with its fate unknown.
   *
   * Premise: onSuspend listeners cannot be awaited — Chrome suspends the
   * worker without waiting for the returned promise. The listener therefore
   * fires emergencyFlushToLocal fire-and-forget on purpose; observability
   * rides on that method's own start/finish logs plus getLastSuspendBackup()
   * (null until a backup of queued data has run), never on awaiting here.
   */
  static registerSuspendHandler(store: SessionStore): void {
    if (store.suspendHandlerRegistered) return;
    if (typeof chrome !== 'undefined' && chrome.runtime?.onSuspend) {
      chrome.runtime.onSuspend.addListener(() => {
        store.emergencyFlushToLocal();
      });
      store.suspendHandlerRegistered = true;
    }
  }

  /**
   * Write queued items to chrome.storage.local. Used as an emergency fallback
   * when the Service Worker is about to suspend. Returns whether the backup
   * landed and records the attempt in getLastSuspendBackup(); success and
   * failure are both logged, so the onSuspend path is observable instead of
   * fire-and-forget.
   */
  async emergencyFlushToLocal(localPort?: SessionLocalPort): Promise<boolean> {
    const port = localPort ?? this.localPort;
    if (this.writeQueue.size === 0) {
      addLog(LogType.INFO, 'SessionStore: suspend backup skipped, nothing queued', {});
      return true;
    }

    const items: Record<string, unknown> = {};
    const keys: string[] = [];
    for (const [key, value] of this.writeQueue) {
      items[key] = value;
      keys.push(key);
    }

    // Attempt start: the onSuspend listener cannot await this method, so the
    // start line is what proves an attempt ran when the finish line is missing
    // (worker died mid-backup).
    addLog(LogType.INFO, 'SessionStore: emergency flush to local storage started', { keys });

    // Same no-guard rationale as backupItemsToLocal: the write attempt itself
    // is the probe, and its outcome is recorded either way.
    try {
      await port.set(items);
    } catch (error) {
      this.lastSuspendBackup = { at: Date.now(), keys, ok: false };
      addLog(LogType.WARN, 'SessionStore: emergency flush to local storage failed', { error: errorMessage(error) });
      return false;
    }
    this.lastSuspendBackup = { at: Date.now(), keys, ok: true };
    addLog(LogType.INFO, 'SessionStore: emergency flush to local storage succeeded', { keys });
    return true;
  }

  /**
   * Outcome of the most recent emergencyFlushToLocal attempt that had queued
   * data, or null when no such attempt ran yet (including empty-queue skips,
   * which log but record nothing). Tests and diagnostics observe the suspend
   * path that onSuspend itself cannot await: null means "never attempted",
   * non-null tells success from failure.
   */
  getLastSuspendBackup(): SuspendBackupStatus | null {
    return this.lastSuspendBackup;
  }

  /**
   * Fallback migration for a single key: if session storage does not contain
   * the requested key but local storage does, move it to session storage.
   * This restores data after session storage is cleared (e.g., Service Worker
   * restart or browser update) without re-scanning all local storage each time.
   *
   * Returns 'migrated' / 'absent' for definitive outcomes and 'failed' for a
   * transient error (logged): only the definitive outcomes may be memoized by
   * the caller.
   */
  static async migrateFromLocalStorageIfSessionEmpty(
    key: string,
    localPort: SessionLocalPort = sharedLocalPort,
  ): Promise<LocalFallbackOutcome> {
    // No chrome-availability guard on purpose: an explicitly injected port
    // works without chrome.storage.*, while a missing backend for the shared
    // port surfaces as a caught failure below and reports 'failed'.
    let localResult: Record<string, unknown>;
    try {
      localResult = await localPort.get(key);
    } catch (error) {
      addLog(LogType.ERROR, 'SessionStore: failed to read local storage for single-key migration', {
        key,
        error: errorMessage(error),
      });
      return 'failed';
    }
    if (!(key in localResult)) return 'absent';

    try {
      await chrome.storage.session.set({ [key]: localResult[key] });
      await localPort.remove(key);

      addLog(LogType.INFO, 'SessionStore: migrated single key from local to session storage', {
        key,
      });
      return 'migrated';
    } catch (error) {
      addLog(LogType.ERROR, 'SessionStore: failed to migrate single key from local storage', {
        key,
        error: errorMessage(error),
      });
      return 'failed';
    }
  }

  /**
   * One-time migration: move session-scoped keys previously stored in
   * chrome.storage.local to chrome.storage.session, then clean up the old keys.
   * Should be called once at service-worker startup before SessionStore is used.
   */
  static async migrateFromLocalStorage(localPort: SessionLocalPort = sharedLocalPort): Promise<boolean> {
    if (!chrome?.storage?.local || !chrome?.storage?.session) {
      return false;
    }

    try {
      const all = await localPort.get(null);
      const entries = Object.entries(all).filter(([key]) => key.startsWith('sw:'));
      if (entries.length === 0) return false;

      const items: Record<string, unknown> = {};
      for (const [key, value] of entries) {
        items[key] = value;
      }

      await chrome.storage.session.set(items);
      await localPort.remove(entries.map(([key]) => key));

      addLog(LogType.INFO, 'SessionStore: migrated session data from local to session storage', {
        keys: entries.map(([key]) => key),
      });
      return true;
    } catch (error) {
      addLog(LogType.ERROR, 'SessionStore: failed to migrate session data', {
        error: errorMessage(error),
      });
      return false;
    }
  }
}

function isQuotaError(error: unknown): boolean {
  const message = errorMessage(error);
  return /quota|QUOTA_BYTES/i.test(message);
}
