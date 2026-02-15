/**
 * Mutex
 * 排他制御用クラス
 * リソースへの同時アクセスを防止し、順次処理を実現
 */
export interface MutexOptions {
    maxQueueSize?: number;
    timeoutMs?: number;
}
export declare class Mutex {
    private locked;
    private queue;
    private lockedAt;
    private nextTaskId;
    private maxQueueSize;
    private timeoutMs;
    constructor(options?: MutexOptions);
    /**
     * ロックを取得する
     */
    acquire(): Promise<void>;
    /**
     * ロックを解放する
     */
    release(): void;
    /**
     * ロック状態を取得
     */
    isLocked(): boolean;
    /**
     * ロック期間を取得
     */
    getLockDuration(): number;
    /**
     * キューサイズを取得
     */
    getQueueSize(): number;
}
//# sourceMappingURL=Mutex.d.ts.map