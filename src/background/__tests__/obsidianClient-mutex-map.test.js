// src/background/__tests__/obsidianClient-mutex-map.test.js
import { ObsidianClient } from '../obsidianClient.js';
import { Mutex } from '../Mutex.js';

describe('Mutex Map improvement', () => {
  let client;

  beforeEach(() => {
    client = new ObsidianClient();
    jest.clearAllMocks();
  });

  test('acquireとreleaseが正しく動作する', async () => {
    const mutex = client._globalWriteMutex;

    // 最初のロックを取得
    await mutex.acquire();
    expect(mutex.isLocked()).toBe(true);

    // キューに入れる
    let secondReleased = false;
    const secondLockPromise = mutex.acquire().then(() => {
      secondReleased = true;
    });
    expect(secondReleased).toBe(false);

    // 一番目を解放
    mutex.release();
    await secondLockPromise;
    expect(secondReleased).toBe(true);

    // ロックが解放され、キューも空であることを確認
    mutex.release();
    expect(mutex.queue.size).toBe(0);
  });

  test('キューサイズ制限（MAX_QUEUE_SIZE=50）', async () => {
    const mutex = client._globalWriteMutex;

    await mutex.acquire();

    const promises = [];
    for (let i = 0; i < 50; i++) {
      promises.push(mutex.acquire());
    }

    // 50個のリクエストがキューに入っていることを確認
    expect(mutex.queue.size).toBe(50);

    // 51番目が拒否されることを確認
    await expect(mutex.acquire()).rejects.toThrow(/queue is full/);

    // クリーンアップ: ロックを解放して、キュー内のタスクを順次処理
    // promisesには50個のPromiseがある
    for (let i = 0; i < 50; i++) {
      mutex.release();
      await promises.shift();
    }
    // 最後のロックを解放
    mutex.release();
  });

  test('Mapでのキュー管理（O(1)操作）', async () => {
    const mutex = new Mutex();

    // 最初のロック取得（キューに入らないのでnextTaskIdは0のまま）
    await mutex.acquire();

    // Map.size プロパティが存在することを確認
    expect(mutex.queue.size).toBeDefined();
    expect(mutex.queue.size).toBe(0);

    // nextTaskIdはロックが解放されるまでは0のまま（正しい動き）
    expect(mutex.nextTaskId).toBe(0);

    // acquire時にエントリがMapに追加される（ロック中なのでキューに入る）
    const p1 = mutex.acquire();
    expect(mutex.queue.size).toBe(1);

    const p2 = mutex.acquire();
    expect(mutex.queue.size).toBe(2);

    // クリーンアップ
    mutex.release();
    await p1;
    mutex.release();
    await p2;
    mutex.release();

    expect(mutex.queue.size).toBe(0);
  });

  test('タイムアウト時にMapからエントリが削除される', async () => {
    // タイムアウト値を一時的に短く設定してテスト
    jest.useFakeTimers();

    const mutex = new Mutex();

    await mutex.acquire();

    // タイムアウト付きでロック要求
    const p1 = mutex.acquire();
    expect(mutex.queue.size).toBe(1);

    // タイムアウトシミュレーション
    jest.advanceTimersByTime(30000);

    // タイムアウトエラーが発生することを確認
    await expect(p1).rejects.toThrow(/timeout/);

    // Mapからエントリが削除されていることを確認
    expect(mutex.queue.size).toBe(0);

    jest.useRealTimers();
  });
});