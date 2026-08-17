// @vitest-environment jsdom
/**
 * Unit tests for idbEngineLifecycle.ts (PBI-01 extraction).
 * Covers init success/failure and lastInitError recording, using a mocked
 * sqliteEngine.js so no real WASM is loaded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExec = vi.fn().mockResolvedValue(undefined);
const mockQuery = vi.fn().mockResolvedValue([]);
const mockQueryValue = vi.fn().mockResolvedValue(1);

vi.mock('../../sqliteEngine.js', () => ({
  createIdbEngine: vi.fn().mockImplementation(() => Promise.resolve({
    exec: mockExec,
    query: mockQuery,
    queryValue: mockQueryValue,
  })),
}));

vi.mock('../../migrations.js', () => ({
  runMigrations: vi.fn().mockResolvedValue({ fts5Available: true }),
}));

const { initIdbEngine, execWithCache, DB_FILENAME } = await import('../idbEngineLifecycle.js');

describe('idbEngineLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExec.mockResolvedValue(undefined);
    mockQuery.mockResolvedValue([]);
  });

  it('DB_FILENAME は yasumaro.db である（単一ソース）', () => {
    expect(DB_FILENAME).toBe('yasumaro.db');
  });

  describe('initIdbEngine', () => {
    it('成功時は true を返し、idbEngine と fts5Available を state に設定する', async () => {
      const state = { idbEngine: null, fts5Available: false, cachedCompileOptions: null, lastInitError: null } as {
        idbEngine: unknown; fts5Available: boolean; cachedCompileOptions: string[] | null; lastInitError: string | null;
      };

      const ok = await initIdbEngine(state);

      expect(ok).toBe(true);
      expect(state.idbEngine).not.toBeNull();
      expect(state.fts5Available).toBe(true);
      expect(mockExec).toHaveBeenCalledWith('PRAGMA journal_mode=WAL;');
    });

    it('失敗時は false を返し、lastInitError を記録し idbEngine を null にする', async () => {
      mockExec.mockRejectedValueOnce(new Error('disk full'));
      const state = { idbEngine: null, fts5Available: false, cachedCompileOptions: null, lastInitError: null } as {
        idbEngine: unknown; fts5Available: boolean; cachedCompileOptions: string[] | null; lastInitError: string | null;
      };

      const ok = await initIdbEngine(state);

      expect(ok).toBe(false);
      expect(state.idbEngine).toBeNull();
      expect(state.lastInitError).toBe('disk full');
    });
  });

  describe('execWithCache', () => {
    it('callback 無しの場合は exec のみ呼ぶ', async () => {
      const engine = { exec: mockExec, query: mockQuery };
      await execWithCache(engine as unknown as Parameters<typeof execWithCache>[0], 'DELETE FROM x', [1]);
      expect(mockExec).toHaveBeenCalledWith('DELETE FROM x', [1]);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('callback ありの場合は query で行ごとに呼ぶ', async () => {
      mockQuery.mockResolvedValueOnce([{ a: 1, b: 'x' }, { a: 2, b: 'y' }]);
      const engine = { exec: mockExec, query: mockQuery };
      const rows: unknown[][] = [];

      await execWithCache(engine as unknown as Parameters<typeof execWithCache>[0], 'SELECT a, b FROM x', [], (row) => rows.push(row));

      expect(rows).toEqual([[1, 'x'], [2, 'y']]);
    });
  });
});
