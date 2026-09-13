// @vitest-environment jsdom
/**
 * Unit tests for migrationBackup.ts (PBI-01 extraction).
 * Covers extractDomain and runMigrationRestore's count-comparison branch.
 * The backup path (wa-sqlite dynamic import) is covered end-to-end by
 * idb-migration.test.ts; not duplicated here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StorageKeys } from '../../../utils/storage/types.js';

const mockExecWithCache = vi.fn();
vi.mock('../idbEngineLifecycle.js', () => ({
  execWithCache: (...args: unknown[]) => mockExecWithCache(...args),
  DB_FILENAME: 'yasumaro.db',
}));

const { extractDomain, runMigrationRestore } = await import('../migrationBackup.js');

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
  });
});
