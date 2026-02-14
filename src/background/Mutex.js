/**
 * Mutex
 * 排他制御用クラス
 * リソースへの同時アクセスを防止し、順次処理を実現
 */

import { addLog, LogType } from '../utils/logger.js';

export class Mutex {
    constructor(options = {}) {
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
    async acquire() {
        const now = Date.now();

        if (this.queue.size >= this.maxQueueSize) {
            addLog(LogType.ERROR, 'Mutex: Queue is full, rejecting request', {
                queueLength: this.queue.size,
                maxSize: this.maxQueueSize
            });
            throw new Error(`Mutex queue is full (max ${this.maxQueueSize}). Too many concurrent requests.`);
        }

        if (this.locked) {
            return new Promise((resolve, reject) => {
                const taskId = this.nextTaskId++;
                const timeoutId = setTimeout(() => {
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
        addLog(LogType.DEBUG, 'Mutex: Lock acquired');
    }

    /**
     * ロックを解放する
     */
    release() {
        if (!this.locked) {
            addLog(LogType.WARN, 'Mutex: Attempting to release unlocked mutex');
            return;
        }

        if (this.queue.size > 0) {
            const [taskId, task] = this.queue.entries().next().value;
            this.queue.delete(taskId);

            if (task && task.timeoutId) {
                clearTimeout(task.timeoutId);
            }

            this.lockedAt = Date.now();

            if (task && task.resolve) {
                task.resolve();
            }

            addLog(LogType.DEBUG, 'Mutex: Lock transferred to waiting task', {
                remainingQueue: this.queue.size
            });
        } else {
            this.locked = false;
            this.lockedAt = null;
            addLog(LogType.DEBUG, 'Mutex: Lock released');
        }
    }

    /**
     * ロック状態を取得
     */
    isLocked() {
        return this.locked;
    }

    /**
     * ロック期間を取得
     */
    getLockDuration() {
        if (!this.locked || !this.lockedAt) {
            return 0;
        }
        return Date.now() - this.lockedAt;
    }

    /**
     * キューサイズを取得
     */
    getQueueSize() {
        return this.queue.size;
    }
}