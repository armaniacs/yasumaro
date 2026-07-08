// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Track exec calls to control behavior per SQL statement
const mockExec = vi.fn();
let mockDbHandle = {};

// Mock wa-sqlite (IDB path will use this after OPFS Worker fails)
vi.mock('wa-sqlite/dist/wa-sqlite-async.mjs', () => ({
  default: vi.fn().mockResolvedValue({
    exec: mockExec,
    open_v2: vi.fn().mockResolvedValue({}),
    vfs_register: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('wa-sqlite', () => ({
  SQLITE_OPEN_CREATE: 4,
  SQLITE_OPEN_READWRITE: 2,
  Factory: vi.fn().mockImplementation((mod: unknown) => mod),
}));

// Mock IDBBatchAtomicVFS
vi.mock('wa-sqlite/src/examples/IDBBatchAtomicVFS.js', () => ({
  default: class MockVFS {
    name = 'mock-vfs';
    constructor(_name: string) {}
  },
  IDBBatchAtomicVFS: class MockVFS {
    name = 'mock-vfs';
    constructor(_name: string) {}
  },
}));

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

  it('logs a warning for non-duplicate-column ALTER TABLE errors', async () => {
    // Make ALTER TABLE throw a "disk full" type error
    mockExec.mockImplementation(async (_db: unknown, sql: string) => {
      if (sql.includes('ALTER TABLE')) {
        throw new Error('disk I/O error: database disk image is malformed');
      }
      // For non-ALTER calls (SCHEMA_SQL, PRAGMA, etc.), succeed
    });

    const { init, _resetForTesting } = await import('../sqlite.js');
    const { resetTestingState } = await import('../offscreen.js');

    // Reset module state
    _resetForTesting?.();

    // Run init — it will fail OPFS Worker path, then attempt IDB path with mocked wa-sqlite
    const result = await init();

    // Should have logged the ALTER TABLE error via console.warn
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('unexpected ALTER TABLE error'),
      expect.stringContaining('disk I/O error')
    );
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
