// @vitest-environment jsdom
/**
 * Unit tests for migrationBackup.ts (PBI-01 extraction).
 * Covers extractDomain, runMigrationRestore's count-comparison branch, and
 * runMigrationBackup's fail-safe abort when the legacy close fails.
 * The happy backup path (wa-sqlite read + snapshot) is covered end-to-end by
 * idb-migration.test.ts; not duplicated here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StorageKeys } from '../../../utils/storage/types.js';
import { ErrorCode } from '../../../utils/logger/types.js';
import { LEGACY_IDB_NAME } from '../../../messaging/sqliteMessages.js';

const mockExecWithCache = vi.fn();
vi.mock('../idbEngineLifecycle.js', () => ({
  execWithCache: (...args: unknown[]) => mockExecWithCache(...args),
  DB_FILENAME: 'yasumaro.db',
}));

// Legacy wa-sqlite seam for runMigrationBackup's close-failure abort path
// (the happy path stays in idb-migration.test.ts).
const { mockLegacyExec, mockLegacyClose, mockLegacyVfsClose, mockLogError, mockLogWarn } = vi.hoisted(() => ({
  mockLegacyExec: vi.fn(),
  mockLegacyClose: vi.fn(),
  mockLegacyVfsClose: vi.fn(),
  mockLogError: vi.fn(),
  mockLogWarn: vi.fn(),
}));

vi.mock('wa-sqlite/dist/wa-sqlite-async.mjs', () => ({
  default: vi.fn().mockResolvedValue({}),
}));

vi.mock('wa-sqlite', () => ({
  SQLITE_OPEN_READWRITE: 2,
  Factory: vi.fn().mockImplementation(() => ({
    vfs_register: vi.fn(),
    open_v2: vi.fn().mockResolvedValue(1),
    exec: (...args: unknown[]) => mockLegacyExec(...args),
    close: (...args: unknown[]) => mockLegacyClose(...args),
  })),
}));

vi.mock('wa-sqlite/src/examples/IDBBatchAtomicVFS.js', () => ({
  IDBBatchAtomicVFS: class MockOldVfs {
    constructor(_name: string) {}
    close = (...args: unknown[]) => mockLegacyVfsClose(...args);
  },
}));

// Spy on the abort log while keeping the real logger (and its other exports).
vi.mock('../../../utils/logger/api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/logger/api.js')>()),
  logError: (...args: unknown[]) => mockLogError(...args),
  logWarn: (...args: unknown[]) => mockLogWarn(...args),
}));

const { extractDomain, runMigrationRestore, runMigrationBackup } = await import('../migrationBackup.js');

describe('migrationBackup', () => {
  describe('extractDomain', () => {
    it('strips the www prefix', () => {
      expect(extractDomain('https://www.example.com/path')).toBe('example.com');
    });

    it('returns null when parsing fails', () => {
      expect(extractDomain('not a url')).toBeNull();
    });
  });

  describe('runMigrationRestore', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      globalThis.chrome = {
        storage: {
          local: {
            get: vi.fn(),
            remove: vi.fn().mockResolvedValue(undefined),
            set: vi.fn().mockResolvedValue(undefined),
          },
        },
      } as unknown as typeof chrome;
    });

    it('only sets the migration done flag and finishes when there is no backup', async () => {
      (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({});

      await runMigrationRestore({ idbEngine: {} as never });

      expect(chrome.storage.local.set).toHaveBeenCalledWith({ [StorageKeys.IDB_MIGRATION_V2_DONE]: true });
      expect(mockExecWithCache).not.toHaveBeenCalled();
    });

    it('deletes the backup and sets the done flag when the counts match', async () => {
      const backup = JSON.stringify({ version: 1, createdAt: 0, records: [{ url: 'https://a.com' }] });
      (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        [StorageKeys.IDB_MIGRATION_BACKUP]: backup,
      });
      mockExecWithCache.mockImplementation(async (_engine, _sql, _params, callback) => {
        callback?.([1]);
      });

      await runMigrationRestore({ idbEngine: {} as never });

      expect(chrome.storage.local.remove).toHaveBeenCalledWith(StorageKeys.IDB_MIGRATION_BACKUP);
      expect(chrome.storage.local.set).toHaveBeenCalledWith({ [StorageKeys.IDB_MIGRATION_V2_DONE]: true });
    });

    it('discards an empty backup and sets the done flag without warning (terminal)', async () => {
      const backup = JSON.stringify({ version: 1, createdAt: 0, records: [] });
      (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        [StorageKeys.IDB_MIGRATION_BACKUP]: backup,
      });
      mockExecWithCache.mockImplementation(async (_engine, _sql, _params, callback) => {
        callback?.([0]);
      });

      await runMigrationRestore({ idbEngine: {} as never });

      expect(chrome.storage.local.remove).toHaveBeenCalledWith(StorageKeys.IDB_MIGRATION_BACKUP);
      expect(chrome.storage.local.set).toHaveBeenCalledWith({ [StorageKeys.IDB_MIGRATION_V2_DONE]: true });
      expect(mockLogWarn).not.toHaveBeenCalled();

      // Second launch: the backup is gone, so no count query and no warn.
      (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
      mockExecWithCache.mockClear();
      mockLogWarn.mockClear();

      await runMigrationRestore({ idbEngine: {} as never });

      expect(mockExecWithCache).not.toHaveBeenCalled();
      expect(mockLogWarn).not.toHaveBeenCalled();
    });

    it('terminates after a mismatched restore so the next launch does not replay it', async () => {
      const backup = JSON.stringify({
        version: 1,
        createdAt: 0,
        records: [{ url: 'https://a.com' }, { url: 'https://b.com' }],
      });
      (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        [StorageKeys.IDB_MIGRATION_BACKUP]: backup,
      });
      // Fake engine: COUNT stays below expected even after INSERTs succeed
      // (uninsertable rows never converge, so retrying every launch is futile).
      mockExecWithCache.mockImplementation(async (_engine, sql, _params, callback) => {
        if (typeof sql === 'string' && sql.startsWith('SELECT COUNT')) {
          callback?.([1]);
        }
      });

      await runMigrationRestore({ idbEngine: {} as never });

      expect(chrome.storage.local.remove).toHaveBeenCalledWith(StorageKeys.IDB_MIGRATION_BACKUP);
      expect(chrome.storage.local.set).toHaveBeenCalledWith({ [StorageKeys.IDB_MIGRATION_V2_DONE]: true });

      // Second launch: the backup is gone, so no restore replay and no warn.
      (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
      mockExecWithCache.mockClear();
      mockLogWarn.mockClear();

      await runMigrationRestore({ idbEngine: {} as never });

      expect(mockExecWithCache).not.toHaveBeenCalled();
      expect(mockLogWarn).not.toHaveBeenCalled();
    });
  });

  describe('runMigrationBackup', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      globalThis.chrome = {
        storage: {
          local: {
            get: vi.fn().mockResolvedValue({}),
            remove: vi.fn().mockResolvedValue(undefined),
            set: vi.fn().mockResolvedValue(undefined),
          },
        },
      } as unknown as typeof chrome;
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('aborts the migration, keeps the backup, and logs a structured error when the legacy VFS close fails', async () => {
      vi.stubGlobal('indexedDB', {
        databases: vi.fn().mockResolvedValue([{ name: LEGACY_IDB_NAME }]),
      });
      mockLegacyExec.mockImplementation(async (_db: unknown, sql: string, callback?: (row: unknown[]) => void) => {
        if (sql.includes('SELECT') && callback) {
          callback(['https://example.com/a']);
        }
      });
      mockLegacyClose.mockResolvedValue(undefined);
      mockLegacyVfsClose.mockRejectedValue(new Error('IDB connection busy'));

      // The abort replaces "proceeding without backup": continuing would hang
      // the new engine's indexedDB.open upgrade (documented hazard).
      await expect(runMigrationBackup({ idbEngine: null })).rejects.toThrow(/close failed/i);

      // The snapshot written before the failed close stays in storage (data preservation).
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          [StorageKeys.IDB_MIGRATION_BACKUP]: expect.stringContaining('https://example.com/a'),
        })
      );
      // Fail-safe: the done flag is NOT written, so the next launch retries.
      expect(chrome.storage.local.set).not.toHaveBeenCalledWith(
        expect.objectContaining({ [StorageKeys.IDB_MIGRATION_V2_DONE]: true })
      );
      // The abort is visible in the structured log with the migration error code.
      expect(mockLogError).toHaveBeenCalledWith(
        expect.stringContaining('aborted after legacy close failure'),
        expect.objectContaining({ error: expect.stringContaining('IDB connection busy') }),
        ErrorCode.STORAGE_MIGRATION_FAILURE,
        'sqlite'
      );
    });
  });
});
