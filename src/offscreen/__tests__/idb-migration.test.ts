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
import { COLUMN_NAMES } from '../schema.js';

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

  it('backs up all 32 columns from the old wa-sqlite IDB database', async () => {
    vi.stubGlobal('indexedDB', {
      databases: vi.fn().mockResolvedValue([{ name: 'idb-batch-atomic', version: 5 }]),
    });

    // Build a full 32-column row in COLUMN_NAMES order.
    const fullRow: unknown[] = [
      'https://example.com/full', // url
      'Full Title',               // title
      'Full Summary',             // summary
      '#tag1 #tag2',              // tags
      1234567890,                 // created_at
      'example.com',              // domain
      42,                         // visit_duration
      0.75,                       // scroll_ratio
      1,                          // is_starred
      0,                          // is_deleted
      1,                          // obsidian_synced
      0,                          // gist_synced
      'page content',             // content
      5,                          // masked_count
      'ads',                      // cleansed_reason
      'openai',                   // ai_provider
      'gpt-4',                    // ai_model
      500,                        // ai_duration_ms
      1200,                       // obsidian_duration_ms
      100,                        // sent_tokens
      50,                         // received_tokens
      200,                        // original_tokens
      150,                        // cleansed_tokens
      10000,                      // page_bytes
      5000,                       // candidate_bytes
      8000,                       // original_bytes
      4000,                       // cleansed_bytes
      2000,                       // ai_summary_original_bytes
      1500,                       // ai_summary_cleansed_bytes
      6000,                       // extracted_sentences_bytes
      10000,                      // extracted_sentences_original_bytes
      1,                          // fallback_triggered
    ];
    expect(fullRow).toHaveLength(COLUMN_NAMES.length);

    mockOldExec.mockImplementation(async (_db: unknown, sql: string, callback?: (row: unknown[]) => void) => {
      if (sql.includes('SELECT') && callback) {
        callback(fullRow);
      }
    });

    const { engine } = await import('../sqliteEngineContext.js');
    engine.resetForTesting();

    await engine.init();

    expect(mockOldExec).toHaveBeenCalled();
    const setCalls = (chromeMock.storage.local.set as ReturnType<typeof vi.fn>).mock.calls;
    const backupCall = setCalls.find((call: unknown[]) => {
      const arg = call[0] as Record<string, unknown>;
      return arg && typeof arg === 'object' && 'idb_migration_backup' in arg;
    });
    expect(backupCall).toBeDefined();
    const backupJson = (backupCall![0] as Record<string, string>).idb_migration_backup;
    const payload = JSON.parse(backupJson);
    expect(payload.records).toHaveLength(1);
    const record = payload.records[0];

    for (const column of COLUMN_NAMES) {
      expect(record).toHaveProperty(column);
    }

    // Spot-check diagnostic fields are preserved with correct types/values
    expect(record.content).toBe('page content');
    expect(record.masked_count).toBe(5);
    expect(record.ai_provider).toBe('openai');
    expect(record.sent_tokens).toBe(100);
    expect(record.page_bytes).toBe(10000);
    expect(record.fallback_triggered).toBe(1);
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
