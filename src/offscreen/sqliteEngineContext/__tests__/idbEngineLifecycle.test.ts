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
type IdbeEngineState = import('../idbEngineLifecycle.js').IdbeEngineState;

describe('idbEngineLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExec.mockResolvedValue(undefined);
    mockQuery.mockResolvedValue([]);
  });

  it('DB_FILENAME is yasumaro.db (single source)', () => {
    expect(DB_FILENAME).toBe('yasumaro.db');
  });

  describe('initIdbEngine', () => {
    it('returns true on success and sets idbEngine and fts5Available on state', async () => {
      const state = { idbEngine: null, fts5Available: false, cachedCompileOptions: null, lastInitError: null } as IdbeEngineState;

      const ok = await initIdbEngine(state);

      expect(ok).toBe(true);
      expect(state.idbEngine).not.toBeNull();
      expect(state.fts5Available).toBe(true);
      expect(mockExec).toHaveBeenCalledWith('PRAGMA journal_mode=WAL;');
    });

    it('returns false on failure and records lastInitError while nulling idbEngine', async () => {
      mockExec.mockRejectedValueOnce(new Error('disk full'));
      const state = { idbEngine: null, fts5Available: false, cachedCompileOptions: null, lastInitError: null } as IdbeEngineState;

      const ok = await initIdbEngine(state);

      expect(ok).toBe(false);
      expect(state.idbEngine).toBeNull();
      expect(state.lastInitError).toBe('disk full');
    });
  });

  describe('execWithCache', () => {
    it('calls only exec when no callback is given', async () => {
      const engine = { exec: mockExec, query: mockQuery };
      await execWithCache(engine as unknown as Parameters<typeof execWithCache>[0], 'DELETE FROM x', [1]);
      expect(mockExec).toHaveBeenCalledWith('DELETE FROM x', [1]);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('calls back per row via query when a callback is given', async () => {
      mockQuery.mockResolvedValueOnce([{ a: 1, b: 'x' }, { a: 2, b: 'y' }]);
      const engine = { exec: mockExec, query: mockQuery };
      const rows: unknown[][] = [];

      await execWithCache(engine as unknown as Parameters<typeof execWithCache>[0], 'SELECT a, b FROM x', [], (row) => rows.push(row));

      expect(rows).toEqual([[1, 'x'], [2, 'y']]);
    });
  });
});
