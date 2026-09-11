/**
 * robustness-mutex-queue-limit.test.ts
 * Mutexキューサイズ制限とロックタイムアウトのテスト
 * ブルーチーム報告 P0: Mutexにキュー上限を追加
 */

import { Mutex } from '../../utils/Mutex.js';
import { addLog, LogType } from '../../utils/logger.js';

vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: {
    DEBUG: 'DEBUG',
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR'
  }
}));

describe('Mutex: キューサイズ制限とロックタイムアウト', () => {
  let mutex: Mutex;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('キューサイズ制限', () => {
    it('limits the queue with the default maxQueueSize=50', async () => {
      mutex = new Mutex({ maxQueueSize: 50, timeoutMs: 120000 });

      // ロックを取得（解放しない）
      await mutex.acquire();
      expect(mutex.isLocked()).toBe(true);

      // 50個のタスクをキューに入れる（maxQueueSize = 50）
      for (let i = 0; i < 50; i++) {
        mutex.acquire().catch(() => {}); // タイムアウトは無視
      }
      expect(mutex.getQueueSize()).toBe(50);

      // 51個目はエラーをスローするはず（即座にスロー）
      await expect(mutex.acquire()).rejects.toThrow('Mutex queue is full');

      // ログが出力されること
      expect(addLog).toHaveBeenCalledWith(
        LogType.ERROR,
        'Mutex: Queue is full, rejecting request',
        expect.objectContaining({
          queueLength: 50,
          maxSize: 50
        })
      );

      // クリーンアップ
      for (let i = 0; i < 50; i++) {
        mutex.release();
      }
    });

    it('limits the queue with a custom maxQueueSize', async () => {
      mutex = new Mutex({ maxQueueSize: 3, timeoutMs: 120000 });

      await mutex.acquire();

      // 3個のタスクをキューに入れる
      for (let i = 0; i < 3; i++) {
        mutex.acquire().catch(() => {});
      }
      expect(mutex.getQueueSize()).toBe(3);

      // 4個目はエラー
      await expect(mutex.acquire()).rejects.toThrow('Mutex queue is full (max 3)');

      // クリーンアップ
      for (let i = 0; i < 3; i++) {
        mutex.release();
      }
    });

    it('includes an appropriate error message when the queue limit is reached', async () => {
      mutex = new Mutex({ maxQueueSize: 2, timeoutMs: 120000 });

      await mutex.acquire();

      for (let i = 0; i < 2; i++) {
        mutex.acquire().catch(() => {});
      }

      await expect(mutex.acquire()).rejects.toThrow('Mutex queue is full');

      // クリーンアップ
      for (let i = 0; i < 2; i++) {
        mutex.release();
      }
    });

    it('logs when the queue limit is reached', async () => {
      mutex = new Mutex({ maxQueueSize: 1, timeoutMs: 120000 });

      await mutex.acquire();
      mutex.acquire().catch(() => {});

      try {
        await mutex.acquire();
      } catch {
        // noop
      }

      expect(addLog).toHaveBeenCalledWith(
        LogType.ERROR,
        'Mutex: Queue is full, rejecting request',
        expect.any(Object)
      );

      // クリーンアップ
      mutex.release();
    });
  });

  describe('ロックタイムアウト', () => {
    it('releases the lock after the timeout', async () => {
      // タイムアウトを短くして高速テスト
      mutex = new Mutex({ maxQueueSize: 50, timeoutMs: 100 });

      // ロックを取得（解放しない = デッドロックシミュレート）
      await mutex.acquire();
      expect(mutex.isLocked()).toBe(true);

      // acquire() はロックが保持されているので待機状態になる
      const acquirePromise = mutex.acquire();

      // タイムアウト（100ms）を待つ
      await expect(acquirePromise).rejects.toThrow(
        'Mutex acquisition timeout after 100ms'
      );
    }, 10000);

    it('applies the custom timeout', async () => {
      mutex = new Mutex({ maxQueueSize: 50, timeoutMs: 50 });

      await mutex.acquire();

      const acquirePromise = mutex.acquire();

      // タイムアウト（50ms）を待つ
      await expect(acquirePromise).rejects.toThrow(
        'Mutex acquisition timeout after 50ms'
      );
    }, 10000);

    it('removes tasks from the queue on timeout', async () => {
      mutex = new Mutex({ maxQueueSize: 50, timeoutMs: 50 });

      await mutex.acquire();

      // 2つのタスクをキューに入れる
      const task1 = mutex.acquire();
      const task2 = mutex.acquire();
      expect(mutex.getQueueSize()).toBe(2);

      // 両方のタスクがタイムアウトするのを待つ
      await Promise.allSettled([task1, task2]);

      // キューサイズが0に減少
      expect(mutex.getQueueSize()).toBe(0);
    }, 10000);
  });

  describe('ロックの基本動作', () => {
    it('acquires and releases the lock normally', async () => {
      mutex = new Mutex({ maxQueueSize: 50, timeoutMs: 30000 });

      expect(mutex.isLocked()).toBe(false);

      await mutex.acquire();
      expect(mutex.isLocked()).toBe(true);

      mutex.release();
      expect(mutex.isLocked()).toBe(false);
    });

    it('passes the lock to the next task on release', async () => {
      mutex = new Mutex({ maxQueueSize: 50, timeoutMs: 30000 });

      await mutex.acquire();

      const task2Resolved = vi.fn();
      const task2 = mutex.acquire().then(task2Resolved);

      // この時点ではtask2はまだ待機中
      expect(task2Resolved).not.toHaveBeenCalled();

      // ロックを解放 → task2にロックが渡される
      mutex.release();

      // タスクが完了するまで待機
      await task2;
      expect(task2Resolved).toHaveBeenCalled();
      expect(mutex.isLocked()).toBe(true);

      mutex.release();
    });

    it('logs warn when releasing an unlocked Mutex', () => {
      mutex = new Mutex({ maxQueueSize: 50, timeoutMs: 30000 });

      mutex.release();

      expect(addLog).toHaveBeenCalledWith(
        LogType.WARN,
        'Mutex: Attempting to release unlocked mutex'
      );
    });

    it('returns the lock duration', async () => {
      mutex = new Mutex({ maxQueueSize: 50, timeoutMs: 30000 });

      expect(mutex.getLockDuration()).toBe(0);

      await mutex.acquire();

      // ロック期間は >= 0
      expect(mutex.getLockDuration()).toBeGreaterThanOrEqual(0);

      mutex.release();
      expect(mutex.getLockDuration()).toBe(0);
    });
  });

  describe('メモリ管理', () => {
    it('limits memory usage via the queue size limit', async () => {
      mutex = new Mutex({ maxQueueSize: 10, timeoutMs: 120000 });

      await mutex.acquire();

      // 最大10個まで入る
      for (let i = 0; i < 10; i++) {
        mutex.acquire().catch(() => {});
      }

      expect(mutex.getQueueSize()).toBe(10);

      // 11個目はエラー
      await expect(mutex.acquire()).rejects.toThrow('Mutex queue is full');

      // キューサイズは10のまま
      expect(mutex.getQueueSize()).toBe(10);

      // クリーンアップ: すべて解放
      for (let i = 0; i < 10; i++) {
        mutex.release();
      }

      // キューが空になった
      expect(mutex.getQueueSize()).toBe(0);
    });

    it('releases resources when the queue becomes empty', async () => {
      mutex = new Mutex({ maxQueueSize: 50, timeoutMs: 30000 });

      await mutex.acquire();

      const task1 = mutex.acquire();
      const task2 = mutex.acquire();

      expect(mutex.getQueueSize()).toBe(2);

      // ロック解放 → task1に渡す
      mutex.release();
      await task1;

      // ロック解放 → task2に渡す
      mutex.release();
      await task2;

      expect(mutex.getQueueSize()).toBe(0);
      expect(mutex.isLocked()).toBe(true);

      mutex.release();
      expect(mutex.isLocked()).toBe(false);
    });
  });
});
