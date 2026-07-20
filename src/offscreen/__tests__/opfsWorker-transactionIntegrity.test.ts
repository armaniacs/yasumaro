// @vitest-environment jsdom
/**
 * opfsWorker-transactionIntegrity.test.ts
 * Tests for OPFS SQLite transaction integrity (WAL, BEGIN IMMEDIATE, changes(),
 * atomic purge). Isolated in its own file so module-level engine state from
 * other tests does not leak.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock createEngine to avoid WASM dependency
vi.mock('../sqliteEngine.js', () => ({
  createEngine: vi.fn(),
  SqliteEngine: class {},
}));

vi.mock('../utils/errorUtils.js', () => ({
  errorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

vi.mock('../opfsMigrationV2Reader.js', () => ({
  readOldDbRecords: vi.fn().mockResolvedValue([]),
  deleteOldDbFile: vi.fn().mockResolvedValue(undefined),
}));

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn((_keys: string | string[], callback: (items: Record<string, unknown>) => void) => {
        callback({ opfs_migration_v2_done: false });
      }),
      set: vi.fn((_items: Record<string, unknown>, callback?: () => void) => {
        if (callback) callback();
      }),
    },
  },
} as never);

describe('opfsWorker transaction integrity', () => {
  let handleRequest: (req: { id: number; type: string; payload: unknown }) => Promise<{ id: number; success: boolean; result?: unknown; error?: string }>;

  function createMockEngine() {
    const execCalls: string[] = [];
    const execMock = vi.fn().mockImplementation(async (sql: string) => {
      execCalls.push(sql);
    });
    const queryMock = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT changes()')) {
        return [{ c: 1 }];
      }
      if (sql.includes('SELECT COUNT(*)')) {
        return [{ c: 5 }];
      }
      return [];
    });
    const queryValueMock = vi.fn().mockResolvedValue(0);

    return {
      exec: execMock,
      query: queryMock,
      queryValue: queryValueMock,
      close: vi.fn().mockResolvedValue(undefined),
      execCalls,
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import('../opfsWorker.js');
    handleRequest = mod.handleRequest;
  });

  it('initializes with WAL mode before schema', async () => {
    const { createEngine } = await import('../sqliteEngine.js');
    const mockEngine = createMockEngine();
    vi.mocked(createEngine).mockResolvedValue(mockEngine as never);

    await handleRequest({ id: 1, type: 'STATUS', payload: {} });

    const walIndex = mockEngine.execCalls.indexOf('PRAGMA journal_mode=WAL;');
    const schemaCall = mockEngine.execCalls.find((sql) => sql.includes('CREATE TABLE IF NOT EXISTS browsing_logs'));
    expect(walIndex).toBeGreaterThanOrEqual(0);
    expect(schemaCall).toBeDefined();
    expect(mockEngine.execCalls.indexOf(schemaCall!)).toBeGreaterThan(walIndex);
  });

  it('handleInsertBatch uses BEGIN IMMEDIATE and returns changes() count', async () => {
    const { createEngine } = await import('../sqliteEngine.js');
    const mockEngine = createMockEngine();
    vi.mocked(createEngine).mockResolvedValue(mockEngine as never);

    const result = await handleRequest({
      id: 1,
      type: 'INSERT_BATCH',
      payload: [
        {
          url: 'https://example.com',
          title: 'Example',
          content: 'content',
          created_at: Date.now(),
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.result).toEqual({ count: 1 });
    expect(mockEngine.execCalls).toContain('BEGIN IMMEDIATE');
    expect(mockEngine.execCalls).toContain('COMMIT');
    expect(mockEngine.execCalls).not.toContain('ROLLBACK');
  });

  it('handlePurgeOldRecords wraps both DELETEs in a single transaction', async () => {
    const { createEngine } = await import('../sqliteEngine.js');
    const mockEngine = createMockEngine();
    vi.mocked(createEngine).mockResolvedValue(mockEngine as never);

    const result = await handleRequest({
      id: 1,
      type: 'PURGE',
      payload: { retentionDays: 30, maxRecords: 3 },
    });

    expect(result.success).toBe(true);
    const beginIndex = mockEngine.execCalls.indexOf('BEGIN IMMEDIATE');
    const commitIndex = mockEngine.execCalls.indexOf('COMMIT');
    expect(beginIndex).toBeGreaterThanOrEqual(0);
    expect(commitIndex).toBeGreaterThan(beginIndex);
    expect(mockEngine.execCalls).not.toContain('ROLLBACK');
  });
});
