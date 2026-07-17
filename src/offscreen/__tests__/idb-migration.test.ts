// @vitest-environment jsdom
/**
 * Tests for the wa-sqlite IDBBatchAtomicVFS -> @subframe7536/sqlite-wasm IDB
 * VFS migration path (PBI: 2026-07-16-06). Covers migrateIdbIfNeeded (backup
 * before migration) and restoreFromMigrationBackupIfPresent (verify/restore
 * after migration), using mocked wa-sqlite / sqliteEngine.js so no real WASM
 * is loaded.
 *
 * The end-to-end IndexedDB schema-compatibility claim (that useIdbStorage's
 * built-in onupgradeneeded migration preserves existing wa-sqlite records)
 * was verified separately via a Node.js + fake-indexeddb spike during
 * brainstorming for this PBI, not re-verified here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockIdbExec = vi.fn().mockResolvedValue(undefined);
const mockIdbQuery = vi.fn().mockResolvedValue([]);
const mockIdbQueryValue = vi.fn().mockResolvedValue(null);
const mockIdbClose = vi.fn().mockResolvedValue(undefined);

vi.mock('../sqliteEngine.js', () => ({
  createIdbEngine: vi.fn().mockImplementation(() => Promise.resolve({
    exec: mockIdbExec,
    query: mockIdbQuery,
    queryValue: mockIdbQueryValue,
    close: mockIdbClose,
  })),
  createEngine: vi.fn(),
}));

const mockOldExec = vi.fn().mockResolvedValue(undefined);
const mockOldVfsClose = vi.fn().mockResolvedValue(undefined);

vi.mock('wa-sqlite/dist/wa-sqlite-async.mjs', () => ({
  default: vi.fn().mockResolvedValue({}),
}));

vi.mock('wa-sqlite', () => ({
  SQLITE_OPEN_CREATE: 4,
  SQLITE_OPEN_READWRITE: 2,
  Factory: vi.fn().mockImplementation(() => ({
    vfs_register: vi.fn(),
    open_v2: vi.fn().mockResolvedValue(1),
    exec: mockOldExec,
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('wa-sqlite/src/examples/IDBBatchAtomicVFS.js', () => ({
  IDBBatchAtomicVFS: class MockOldVfs {
    constructor(_name: string) {}
    close = mockOldVfsClose;
  },
}));

vi.mock('../storageFallback.js', () => ({
  FallbackStorage: class {
    async getAllRecords() { return []; }
    async clearAll() {}
  },
}));

function makeChromeStorageMock() {
  const store: Record<string, unknown> = {};
  return {
    storage: {
      local: {
        get: vi.fn().mockImplementation((key: string) => Promise.resolve({ [key]: store[key] })),
        set: vi.fn().mockImplementation((items: Record<string, unknown>) => {
          Object.assign(store, items);
          return Promise.resolve();
        }),
        remove: vi.fn().mockImplementation((key: string) => {
          delete store[key];
          return Promise.resolve();
        }),
      },
    },
    runtime: { id: 'test-extension-id' },
  };
}

describe('SqliteEngineContext: IDB migration (wa-sqlite -> @subframe7536)', () => {
  let chromeMock: ReturnType<typeof makeChromeStorageMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    chromeMock = makeChromeStorageMock();
    vi.stubGlobal('chrome', chromeMock as never);
    vi.stubGlobal('Worker', vi.fn(() => {
      throw new Error('Worker not available in test');
    }));
    Object.defineProperty(globalThis.navigator, 'storage', {
      value: { getDirectory: vi.fn().mockRejectedValue(new Error('OPFS not available')) },
      configurable: true,
    });
    vi.stubGlobal('indexedDB', { databases: vi.fn().mockResolvedValue([]) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('skips backup and marks migration done when no old wa-sqlite IDB database exists', async () => {
    const { engine } = await import('../sqliteEngineContext.js');
    engine.resetForTesting();

    const result = await engine.init();

    expect(result).toBe(true);
    expect(mockOldExec).not.toHaveBeenCalled();
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ idb_migration_v2_done: true })
    );
  });

  it('backs up records from the old wa-sqlite IDB database when detected, then closes its VFS', async () => {
    vi.stubGlobal('indexedDB', {
      databases: vi.fn().mockResolvedValue([{ name: 'idb-batch-atomic', version: 5 }]),
    });
    mockOldExec.mockImplementation(async (_db: unknown, sql: string, callback?: (row: unknown[]) => void) => {
      if (sql.includes('SELECT') && callback) {
        callback(['https://example.com/a', 'Title A', 'Summary A', null, 1000, 'example.com', null, null, 0, 0, 0, 0]);
      }
    });

    const { engine } = await import('../sqliteEngineContext.js');
    engine.resetForTesting();

    await engine.init();

    expect(mockOldExec).toHaveBeenCalled();
    expect(mockOldVfsClose).toHaveBeenCalled();
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        idb_migration_backup: expect.stringContaining('https://example.com/a'),
      })
    );
  });

  it('clears the backup and marks migration done when the new engine record count matches', async () => {
    vi.stubGlobal('indexedDB', {
      databases: vi.fn().mockResolvedValue([{ name: 'idb-batch-atomic', version: 5 }]),
    });
    mockOldExec.mockImplementation(async (_db: unknown, sql: string, callback?: (row: unknown[]) => void) => {
      if (sql.includes('SELECT') && callback) {
        callback(['https://example.com/a', 'Title A', 'Summary A', null, 1000, 'example.com', null, null, 0, 0, 0, 0]);
      }
    });
    // New engine reports 1 row post-migration, matching the 1 backed-up record.
    mockIdbQuery.mockResolvedValue([{ 'COUNT(*)': 1 }]);

    const { engine } = await import('../sqliteEngineContext.js');
    engine.resetForTesting();

    await engine.init();

    expect(chromeMock.storage.local.remove).toHaveBeenCalledWith('idb_migration_backup');
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ idb_migration_v2_done: true })
    );
  });

  it('restores from backup via INSERT OR IGNORE and leaves the backup in place on count mismatch', async () => {
    vi.stubGlobal('indexedDB', {
      databases: vi.fn().mockResolvedValue([{ name: 'idb-batch-atomic', version: 5 }]),
    });
    mockOldExec.mockImplementation(async (_db: unknown, sql: string, callback?: (row: unknown[]) => void) => {
      if (sql.includes('SELECT') && callback) {
        callback(['https://example.com/a', 'Title A', 'Summary A', null, 1000, 'example.com', null, null, 0, 0, 0, 0]);
      }
    });
    // New engine reports 0 rows post-migration (simulated failure) despite 1 backed-up record.
    mockIdbQuery.mockResolvedValue([{ 'COUNT(*)': 0 }]);

    const { engine } = await import('../sqliteEngineContext.js');
    engine.resetForTesting();

    await engine.init();

    // execWithCache with INSERT_IGNORE_SQL should have been attempted via exec()
    expect(mockIdbExec).toHaveBeenCalled();
    // Backup must remain (not cleared) since verification failed
    expect(chromeMock.storage.local.remove).not.toHaveBeenCalledWith('idb_migration_backup');
    expect(chromeMock.storage.local.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ idb_migration_v2_done: true })
    );
  });
});
