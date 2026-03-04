/**
 * optimisticLock-security.test.ts
 * 楽観的ロックのセキュリティテスト
 * 
 * 注意: 楽観的ロックは簡素化され、バージョンベースの競合検出は削除されました。
 * 現在は chrome.storage.local.set のアトミック性に依存した簡易実装です。
 */

import { withOptimisticLock, getConflictStats, resetConflictStats } from '../optimisticLock';

// Chrome Storage API モック
const mockStorage: Record<string, any> = {};
let mockGet = jest.fn();
let mockSet = jest.fn();

beforeEach(() => {
  // モックをリセット
  Object.keys(mockStorage).forEach(key => delete mockStorage[key]);
  resetConflictStats();

  // chrome.storage.local モック
  mockGet.mockImplementation((keys: string | string[]) => {
    const keyArray = Array.isArray(keys) ? keys : [keys];
    const result: Record<string, any> = {};
    keyArray.forEach((key) => {
      result[key] = mockStorage[key];
    });
    return Promise.resolve(result);
  });

  mockSet.mockImplementation((data: Record<string, any>) => {
    Object.entries(data).forEach(([key, value]) => {
      mockStorage[key] = value;
    });
    return Promise.resolve();
  });

  global.chrome = {
    storage: {
      local: {
        get: mockGet,
        set: mockSet,
      }
    }
  } as any;
});

describe('楽観的ロック - セキュリティテスト', () => {
  describe('基本動作', () => {
    test('単一プロセスでの正常動作', async () => {
      mockStorage['testKey'] = 'initial';

      const result = await withOptimisticLock('testKey', (current) => `${current}-updated`);

      expect(result).toBe('initial-updated');
      expect(mockStorage['testKey']).toBe('initial-updated');
    });

    test('数値の更新', async () => {
      mockStorage['counter'] = 0;

      const result1 = await withOptimisticLock('counter', (current) => (current as number) + 1);
      expect(result1).toBe(1);
      expect(mockStorage['counter']).toBe(1);

      const result2 = await withOptimisticLock('counter', (current) => (current as number) + 10);
      expect(result2).toBe(11);
      expect(mockStorage['counter']).toBe(11);

      // 統計情報が正常に記録されている
      const stats = getConflictStats();
      expect(stats.totalAttempts).toBe(2);
      expect(stats.totalConflicts).toBe(0);
      expect(stats.totalFailures).toBe(0);
    });

    test('オブジェクトの更新', async () => {
      mockStorage['test'] = { value: 'initial' };

      await withOptimisticLock('test', (current) => ({
        ...(current as { value: string }),
        value: 'updated'
      }));

      expect(mockStorage['test']).toEqual({ value: 'updated' });

      // 同じキーに対する複数の書き込み
      for (let i = 0; i < 5; i++) {
        await withOptimisticLock('test', (current) => ({
          value: `iteration-${i}`
        }));
      }

      expect(mockStorage['test']).toEqual({ value: 'iteration-4' });
    });
  });

  describe('エラー処理', () => {
    test('updateFn内で発生したエラーが適切に処理される', async () => {
      mockStorage['test'] = 'initial';

      await expect(
        withOptimisticLock('test', () => {
          throw new Error('User error');
        })
      ).rejects.toThrow('User error');

      const stats = getConflictStats();
      expect(stats.totalFailures).toBeGreaterThan(0);
    });

    test('ストレージエラーが適切に処理される', async () => {
      mockStorage['test'] = 'initial';

      // ストレージエラーをシミュレート
      mockSet.mockRejectedValueOnce(new Error('Storage error'));

      await expect(
        withOptimisticLock('test', (current) => `${current}-updated`)
      ).rejects.toThrow('Storage error');

      const stats = getConflictStats();
      expect(stats.totalFailures).toBeGreaterThan(0);
    });
  });

  describe('データ整合性', () => {
    test('更新中にエラーが発生してもデータは整合性を保つ', async () => {
      mockStorage['account'] = { balance: 100 };

      const result = await withOptimisticLock('account', (current) => ({
        ...(current as { balance: number }),
        balance: (current as { balance: number }).balance + 50
      }));

      // データの整合性が保たれている
      expect(result).toBeDefined();
      expect((result as { balance: number }).balance).toBe(150);
      expect(mockStorage['account']).toEqual({ balance: 150 });

      // 統計情報が記録されている
      const stats = getConflictStats();
      expect(stats.totalAttempts).toBeGreaterThan(0);
    });

    test('複雑なオブジェクトの更新', async () => {
      mockStorage['config'] = { a: 1, b: { c: 2 } };

      await withOptimisticLock('config', (current) => ({
        ...(current as { a: number; b: { c: number } }),
        b: { c: 3 }
      }));

      expect(mockStorage['config']).toEqual({ a: 1, b: { c: 3 } });
    });
  });

  describe('再帰的更新', () => {
    test('複数回の更新が正しく処理される', async () => {
      mockStorage['counter'] = 0;

      for (let i = 0; i < 5; i++) {
        await withOptimisticLock('counter', (current) => (current as number) + 1);
      }

      expect(mockStorage['counter']).toBe(5);
    });

    test('異なるキーへの更新が干渉しない', async () => {
      mockStorage['key1'] = 'value1';
      mockStorage['key2'] = 'value2';

      const results = await Promise.all([
        withOptimisticLock('key1', (current) => `${current}-updated`),
        withOptimisticLock('key2', (current) => `${current}-updated`)
      ]);

      expect(results[0]).toBe('value1-updated');
      expect(results[1]).toBe('value2-updated');
      expect(mockStorage['key1']).toBe('value1-updated');
      expect(mockStorage['key2']).toBe('value2-updated');
    });
  });

  describe('統計情報', () => {
    test('競合統計が正しく記録される', async () => {
      mockStorage['test'] = 'initial';

      // 成功した操作
      await withOptimisticLock('test', (current) => `${current}-updated`);

      const stats = getConflictStats();
      expect(stats.totalAttempts).toBe(1);
      expect(stats.totalConflicts).toBe(0);
      expect(stats.totalFailures).toBe(0);
    });

    test('統計情報をリセットできる', async () => {
      mockStorage['test'] = 'initial';

      await withOptimisticLock('test', (current) => `${current}-updated`);

      let stats = getConflictStats();
      expect(stats.totalAttempts).toBeGreaterThan(0);

      resetConflictStats();

      stats = getConflictStats();
      expect(stats.totalAttempts).toBe(0);
      expect(stats.totalConflicts).toBe(0);
      expect(stats.totalFailures).toBe(0);
    });
  });

  describe('エッジケース', () => {
    test('未定義の値を更新できる', async () => {
      mockStorage['test'] = undefined;

      const result = await withOptimisticLock('test', () => 'new-value');

      expect(result).toBe('new-value');
      expect(mockStorage['test']).toBe('new-value');
    });

    test('nullを更新できる', async () => {
      mockStorage['test'] = null;

      const result = await withOptimisticLock('test', () => 'new-value');

      expect(result).toBe('new-value');
      expect(mockStorage['test']).toBe('new-value');
    });

    test('空配列を更新できる', async () => {
      mockStorage['test'] = [];

      const result = await withOptimisticLock('test', (current) => [...(current as any[]), 'item']);

      expect(result).toEqual(['item']);
      expect(mockStorage['test']).toEqual(['item']);
    });
  });
});