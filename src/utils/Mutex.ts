/**
 * Mutex
 * 排他制御用クラス
 * リソースへの同時アクセスを防止し、順次処理を実現
 */

import { addLog, LogType } from '../utils/logger.js';

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

export interface MutexOptions {
    maxQueueSize?: number;
    timeoutMs?: number;
}

interface MutexTask {
    resolve: () => void;
    reject: (reason?: unknown) => void;
    timestamp: number;
    timeoutId: NodeJS.Timeout;
}

export class Mutex {
    private locked: boolean;
    private queue: Map<number, MutexTask>;
    private lockedAt: number | null;
    private nextTaskId: number;
    private maxQueueSize: number;
    private timeoutMs: number;

    constructor(options: MutexOptions = {}) {
        this.locked = false;
        this.queue = new Map();
        this.lockedAt = null;
        this.nextTaskId = 0;
        this.maxQueueSize = options.maxQueueSize || 50;
        this.timeoutMs = options.timeoutMs || 30000;
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
        safeAddLog(() => void addLog(LogType.DEBUG, 'Mutex: Lock acquired'));
    }

    /**
     * ロックを解放する
     */
    release(): void {
        if (!this.locked) {
            safeAddLog(() => void addLog(LogType.WARN, 'Mutex: Attempting to release unlocked mutex'));
            return;
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

                if (task && task.resolve) {
                    task.resolve();
                }

                safeAddLog(() => void addLog(LogType.DEBUG, 'Mutex: Lock transferred to waiting task', {
                    remainingQueue: this.queue.size
                }));
                return;
            }
        }

        // If queue is empty or something weird happened with iterator
        this.locked = false;
        this.lockedAt = null;
        safeAddLog(() => void addLog(LogType.DEBUG, 'Mutex: Lock released'));
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
}