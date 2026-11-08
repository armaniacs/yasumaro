/**
 * Mutex
 * 排他制御用クラス
 * リソースへの同時アクセスを防止し、順次処理を実現
 */

import { LogType } from './logger/types.js';
import { addLog } from './logger/core.js';

// addLog (and the LogType it's called with) is best-effort diagnostics
// only. If evaluating the call throws synchronously — e.g. a test mocks
// logger.js without exporting addLog or LogType — that must never abort
// the lock state change it follows: an aborted acquire() leaves
// `locked = true` forever with no matching release(), deadlocking every
// future acquirer. The callback form (rather than a variadic wrapper)
// ensures the LogType.* argument expression is evaluated inside the
// try block too, not just the addLog call itself.
function safeAddLog(fn: () => void): void {
    try {
        fn();
    } catch {
        // Logging failure is not this class's concern.
    }
}

/** Diagnostic payload delivered to `onHolderTimeout` when a holder hangs. */
export interface MutexHangInfo {
    lockDurationMs: number;
    thresholdMs: number;
}

export interface MutexOptions {
    maxQueueSize?: number;
    timeoutMs?: number;
    /**
     * Holder watchdog threshold. When the current holder keeps the lock
     * longer than this, the hang is reported (WARN log + `onHolderTimeout` +
     * `getHangDetectedCount()`), but the lock itself is untouched: waiter
     * timing and ownership transfer behave exactly as before.
     * Defaults to `timeoutMs`. Must be a finite number > 0 when given —
     * 0/negative/NaN are rejected instead of being silently defaulted.
     */
    holderTimeoutMs?: number;
    /**
     * Optional hook invoked once per over-long hold. Must never throw into
     * the Mutex: hook errors are swallowed so the lock state stays intact.
     */
    onHolderTimeout?: (info: MutexHangInfo) => void;
}

interface MutexTask {
    resolve: () => void;
    reject: (reason?: unknown) => void;
    timestamp: number;
    timeoutId: NodeJS.Timeout;
}

export class Mutex {
    private static readonly DEFAULT_MAX_QUEUE_SIZE = 50;
    private static readonly DEFAULT_TIMEOUT_MS = 30000;

    private locked: boolean;
    private queue: Map<number, MutexTask>;
    private lockedAt: number | null;
    private nextTaskId: number;
    private maxQueueSize: number;
    private timeoutMs: number;
    private readonly holderTimeoutMs: number;
    private readonly onHolderTimeout: ((info: MutexHangInfo) => void) | null;
    private holderTimer: NodeJS.Timeout | null;
    private holdEpoch: number;
    /** Releases observed while unlocked (double-release / non-holder). */
    private spuriousReleaseCount: number;
    /** Holder holds that outlived `holderTimeoutMs`. */
    private hangDetectedCount: number;

    /**
     * 注意(意図的破壊的変更): 不正オプションは RangeError を投げる (黙示デフォルト化しない) — 0・負数・NaN を渡す呼び出しは修正が必要。
     */
    constructor(options: MutexOptions = {}) {
        this.locked = false;
        this.queue = new Map();
        this.lockedAt = null;
        this.nextTaskId = 0;
        this.holderTimer = null;
        this.holdEpoch = 0;
        this.spuriousReleaseCount = 0;
        this.hangDetectedCount = 0;

        // `??` (not `||`): an explicit 0 must not be silently replaced by
        // the default. Out-of-range values are rejected below so the misuse
        // surfaces at construction instead of hiding as a default.
        const maxQueueSize = options.maxQueueSize ?? Mutex.DEFAULT_MAX_QUEUE_SIZE;
        if (!Number.isInteger(maxQueueSize) || maxQueueSize < 1) {
            throw new RangeError(
                `Mutex: maxQueueSize must be an integer >= 1 (got ${String(maxQueueSize)})`,
            );
        }
        const timeoutMs = options.timeoutMs ?? Mutex.DEFAULT_TIMEOUT_MS;
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
            throw new RangeError(
                `Mutex: timeoutMs must be a finite number > 0 (got ${String(timeoutMs)})`,
            );
        }
        const holderTimeoutMs = options.holderTimeoutMs ?? timeoutMs;
        if (!Number.isFinite(holderTimeoutMs) || holderTimeoutMs <= 0) {
            throw new RangeError(
                `Mutex: holderTimeoutMs must be a finite number > 0 (got ${String(holderTimeoutMs)})`,
            );
        }
        this.maxQueueSize = maxQueueSize;
        this.timeoutMs = timeoutMs;
        this.holderTimeoutMs = holderTimeoutMs;
        this.onHolderTimeout = options.onHolderTimeout ?? null;
    }

    /**
     * ロックを取得する
     */
    private allocateTaskId(): number {
        // Wrap around at MAX_SAFE_INTEGER and avoid colliding with an
        // existing queued taskId (precision/collision guard for long-lived
        // processes with high-frequency acquire()).
        if (this.nextTaskId > Number.MAX_SAFE_INTEGER) {
            this.nextTaskId = 0;
        }
        let attempts = 0;
        while (this.queue.has(this.nextTaskId) && attempts <= this.maxQueueSize) {
            this.nextTaskId++;
            if (this.nextTaskId > Number.MAX_SAFE_INTEGER) {
                this.nextTaskId = 0;
            }
            attempts++;
        }
        return this.nextTaskId++;
    }

    /**
     * Holder watchdog: armed on every new hold (fresh acquire or transfer),
     * disarmed on full unlock. Firing only reports the hang — it never
     * releases the lock or touches waiter timing.
     */
    private armHolderWatchdog(): void {
        this.disarmHolderWatchdog();
        const thresholdMs = this.holderTimeoutMs;
        const epoch = this.holdEpoch;
        this.holderTimer = setTimeout(() => {
            // Stale timer from a previous hold (transfer/unlock re-arms or
            // disarms first): ignore so a new holder is never blamed for the
            // previous holder's overrun.
            if (epoch !== this.holdEpoch || !this.locked || this.lockedAt === null) {
                return;
            }
            const lockDurationMs = Date.now() - this.lockedAt;
            if (lockDurationMs < thresholdMs) {
                return;
            }
            // One-shot per hold: report once, do not re-arm, so a legitimately
            // long operation logs exactly one WARN instead of spamming.
            this.holderTimer = null;
            this.hangDetectedCount++;
            safeAddLog(() => void addLog(LogType.WARN, 'Mutex: lock holder exceeded watchdog threshold', {
                lockDurationMs,
                thresholdMs,
            }));
            const hook = this.onHolderTimeout;
            if (hook !== null) {
                try {
                    hook({ lockDurationMs, thresholdMs });
                } catch {
                    // A diagnostic hook must never break the lock.
                }
            }
        }, thresholdMs);
    }

    private disarmHolderWatchdog(): void {
        if (this.holderTimer !== null) {
            clearTimeout(this.holderTimer);
            this.holderTimer = null;
        }
    }

    async acquire(): Promise<void> {
        const now = Date.now();

        if (this.queue.size >= this.maxQueueSize) {
            safeAddLog(() => void addLog(LogType.ERROR, 'Mutex: Queue is full, rejecting request', {
                queueLength: this.queue.size,
                maxSize: this.maxQueueSize
            }));
            throw new Error(`Mutex queue is full (max ${this.maxQueueSize}). Too many concurrent requests.`);
        }

        if (this.locked) {
            return new Promise((resolve, reject) => {
                const taskId = this.allocateTaskId();
                const timeoutId = setTimeout(() => {
                    // Guard: if release() already transferred this taskId
                    // (clearTimeout + resolve) the entry is gone — do not
                    // double-reject the same Promise.
                    if (!this.queue.has(taskId)) {
                        return;
                    }
                    this.queue.delete(taskId);
                    reject(new Error(`Mutex acquisition timeout after ${this.timeoutMs}ms`));
                }, this.timeoutMs);

                this.queue.set(taskId, {
                    resolve: () => {
                        clearTimeout(timeoutId);
                        resolve();
                    },
                    reject,
                    timestamp: now,
                    timeoutId
                });
            });
        }

        this.locked = true;
        this.lockedAt = Date.now();
        this.holdEpoch++;
        this.armHolderWatchdog();
        safeAddLog(() => void addLog(LogType.DEBUG, 'Mutex: Lock acquired'));
    }

    /**
     * ロックを解放する
     *
     * @returns `true` when this call actually released or transferred a held
     * lock; `false` when the mutex was already unlocked (double-release or a
     * non-holder releasing). The return value is advisory — existing callers
     * that ignore it keep working unchanged — and every `false` is also
     * counted in `getSpuriousReleaseCount()` plus the pre-existing WARN log,
     * so the misuse stays detectable without an ownership-token API break.
     * 注意(意図的破壊的変更): 戻り値 boolean 化 (旧 void) — 無視する既存呼び出しは動作不変、二重解放の検出にのみ使うこと。
     */
    release(): boolean {
        if (!this.locked) {
            this.spuriousReleaseCount++;
            // Keep this call's exact shape: existing tests assert the
            // two-argument form, and the count is exposed via
            // getSpuriousReleaseCount() instead.
            safeAddLog(() => void addLog(LogType.WARN, 'Mutex: Attempting to release unlocked mutex'));
            return false;
        }

        if (this.queue.size > 0) {
            const iterator = this.queue.entries();
            const next = iterator.next();
            if (!next.done) {
                const [taskId, task] = next.value;
                this.queue.delete(taskId);

                if (task && task.timeoutId) {
                    clearTimeout(task.timeoutId);
                }

                this.lockedAt = Date.now();
                this.holdEpoch++;
                this.armHolderWatchdog();

                if (task && task.resolve) {
                    task.resolve();
                }

                safeAddLog(() => void addLog(LogType.DEBUG, 'Mutex: Lock transferred to waiting task', {
                    remainingQueue: this.queue.size
                }));
                return true;
            }
        }

        // If queue is empty or something weird happened with iterator
        this.locked = false;
        this.lockedAt = null;
        this.holdEpoch++;
        this.disarmHolderWatchdog();
        safeAddLog(() => void addLog(LogType.DEBUG, 'Mutex: Lock released'));
        return true;
    }

    /**
     * ロック状態を取得
     */
    isLocked(): boolean {
        return this.locked;
    }

    /**
     * ロック期間を取得
     */
    getLockDuration(): number {
        if (!this.locked || !this.lockedAt) {
            return 0;
        }
        return Date.now() - this.lockedAt;
    }

    /**
     * キューサイズを取得
     */
    getQueueSize(): number {
        return this.queue.size;
    }

    /**
     * キュー上限サイズを取得
     */
    getMaxQueueSize(): number {
        return this.maxQueueSize;
    }

    /**
     * 未ロック状態での release() が観測された回数(二重 release・非保有者の
     * release)。正常系では 0 のまま。
     */
    getSpuriousReleaseCount(): number {
        return this.spuriousReleaseCount;
    }

    /**
     * 保持者が watchdog 閾値を超えたまま保持し続けた回数。
     */
    getHangDetectedCount(): number {
        return this.hangDetectedCount;
    }
}
