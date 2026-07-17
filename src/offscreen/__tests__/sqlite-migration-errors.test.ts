// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Track exec calls to control behavior per SQL statement (IDB engine path,
// used after OPFS Worker fails). Mirrors sqliteEngine.ts's SqliteEngine
// interface (exec/query/queryValue/close) — see PBI 2026-07-16-06.
const mockExec = vi.fn();

vi.mock('../sqliteEngine.js', () => ({
  createIdbEngine: vi.fn().mockImplementation(() => Promise.resolve({
    exec: (sql: string) => mockExec(sql),
    query: vi.fn().mockResolvedValue([]),
    queryValue: vi.fn().mockResolvedValue(null),
    close: vi.fn().mockResolvedValue(undefined),
  })),
  createEngine: vi.fn(),
}));

// migrateIdbIfNeeded() dynamically imports wa-sqlite only when an old IDB
// database is detected; indexedDB.databases() below returns [] so these
// dynamic imports are never reached in this test file's scenarios.

// Mock storageFallback since init() may reference it
vi.mock('../storageFallback.js', () => ({
  FallbackStorage: class {
    async insert() { return { success: true, id: 1 }; }
    async insertBatch() { return { success: true, count: 1 }; }
    async query() { return { rows: [], total: 0 }; }
    async search() { return { rows: [] }; }
    async update() { return { success: true }; }
    async hardDelete() { return { success: true }; }
    async toggleStar() { return { success: true, is_starred: 0 }; }
    async getCount() { return { success: true, count: 0 }; }
    async getStatus() { return { success: true, initialized: false, path: 'fallback', fallback: true, fts5: false }; }
    async clearAll() { return {}; }
    async purgeOldRecords() { return {}; }
    async purgeContent() { return {}; }
    async serialize() { return { success: false, error: 'no serialization' }; }
    async backupDb() { return { success: false, error: 'no backup' }; }
    async restoreDb() { return { success: false, error: 'no restore' }; }
    async insertAuditLog() { return { success: true, id: 1 }; }
    async queryAuditLog() { return { rows: [], total: 0 }; }
  },
}));

describe('ALTER TABLE migration error handling', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Reset module state before each test
    // Ensure Worker constructor fails in test env to trigger IDB path
    vi.stubGlobal('Worker', vi.fn(() => {
      throw new Error('Worker not available in test');
    }));

    // Stub chrome.storage.local for modules that check it
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
    } as never);

    // Stub navigator.storage for OPFS worker check
    Object.defineProperty(globalThis.navigator, 'storage', {
      value: { getDirectory: vi.fn().mockRejectedValue(new Error('OPFS not available')) },
      configurable: true,
    });
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('re-throws non-duplicate-column ALTER TABLE errors through runMigrations()', async () => {
    // Make ALTER TABLE throw a "disk full" type error
    mockExec.mockImplementation(async (_db: unknown, sql: string) => {
      if (sql.includes('ALTER TABLE')) {
        throw new Error('disk I/O error: database disk image is malformed');
      }
      // For non-ALTER calls (SCHEMA_SQL, PRAGMA, etc.), succeed
    });

    const { init, _resetForTesting } = await import('../sqlite.js');

    // Reset module state
    _resetForTesting?.();

    // Run init — it will fail OPFS Worker path, then attempt IDB path with mocked wa-sqlite.
    // runMigrations() re-throws non-duplicate ALTER TABLE errors, which causes IDB path
    // to fail and ultimately fall back to storage.
    const result = await init();

    // The error is re-thrown by runMigrations(), not logged via console.warn
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('unexpected ALTER TABLE error'),
      expect.anything()
    );
    // Init will fail to fully initialize SQLite and fall back to storage
    expect(result).toBe(false);
  });

  it('does NOT log for duplicate column name errors (expected during migration)', async () => {
    // Simulate what happens on fresh install: columns already defined in SCHEMA_SQL
    mockExec.mockImplementation(async (_db: unknown, sql: string) => {
      if (sql.includes('ALTER TABLE')) {
        throw new Error('SQLITE_ERROR: duplicate column name: content');
      }
    });

    const { init, _resetForTesting } = await import('../sqlite.js');
    _resetForTesting?.();

    warnSpy.mockClear();
    await init();

    // Should NOT warn because "duplicate column name" is expected
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('unexpected ALTER TABLE error'),
      expect.any(String)
    );
  });
});
