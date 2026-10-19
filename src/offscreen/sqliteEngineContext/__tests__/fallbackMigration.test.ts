// @vitest-environment jsdom
/**
 * Unit tests for fallbackMigration.ts (PBI-01 extraction).
 * Covers FallbackStorage -> IDB migration and the OPFS_FALLBACK_MODE flag
 * clearing behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StorageKeys } from '../../../utils/storage/types.js';
import { ErrorCode } from '../../../utils/logger/types.js';

const mockGetAllRecords = vi.fn();
const mockClearAll = vi.fn().mockResolvedValue(undefined);

vi.mock('../../storageFallback.js', () => ({
  FallbackStorage: class {
    getAllRecords = mockGetAllRecords;
    clearAll = mockClearAll;
  },
}));

const mockExec = vi.fn().mockResolvedValue(undefined);
vi.mock('../idbEngineLifecycle.js', () => ({
  execWithCache: (...args: unknown[]) => mockExec(...args),
}));

const mockLogInfo = vi.fn();
const mockLogWarn = vi.fn();
const mockLogError = vi.fn();
vi.mock('../../../utils/logger/api.js', () => ({
  logInfo: mockLogInfo,
  logWarn: mockLogWarn,
  logError: mockLogError,
}));

const { tryMigrateFallbackToSqlite } = await import('../fallbackMigration.js');

describe('fallbackMigration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllRecords.mockResolvedValue([]);
    globalThis.chrome = {
      storage: { local: { remove: vi.fn().mockResolvedValue(undefined) } },
    } as unknown as typeof chrome;
  });

  it('clears OPFS_FALLBACK_MODE without migrating anything when there are no records', async () => {
    await tryMigrateFallbackToSqlite({ idbEngine: {} as never });

    expect(mockExec).not.toHaveBeenCalled();
    expect(chrome.storage.local.remove).toHaveBeenCalledWith(StorageKeys.OPFS_FALLBACK_MODE);
  });

  it('skips the migration when idbEngine is missing', async () => {
    mockGetAllRecords.mockResolvedValue([{ url: 'https://example.com', domain: null }]);

    await tryMigrateFallbackToSqlite({ idbEngine: null });

    expect(mockExec).not.toHaveBeenCalled();
  });

  it('migrates records with INSERT OR IGNORE and clears the fallback on success', async () => {
    mockGetAllRecords.mockResolvedValue([
      { url: 'https://example.com', domain: null },
      { url: 'https://foo.com', domain: 'foo.com' },
    ]);

    await tryMigrateFallbackToSqlite({ idbEngine: {} as never });

    expect(mockExec).toHaveBeenCalledTimes(2);
    expect(mockClearAll).toHaveBeenCalledOnce();
    expect(chrome.storage.local.remove).toHaveBeenCalledWith(StorageKeys.OPFS_FALLBACK_MODE);
  });

  it('keeps every record in the fallback store when one insert fails (no clearAll)', async () => {
    mockGetAllRecords.mockResolvedValue([
      { url: 'https://bad.com', domain: 'bad.com' },
      { url: 'https://ok.com', domain: 'ok.com' },
      { url: 'https://ok2.com', domain: 'ok2.com' },
    ]);
    mockExec.mockRejectedValueOnce(new Error('quota exceeded'));

    await expect(tryMigrateFallbackToSqlite({ idbEngine: {} as never })).resolves.toBeUndefined();

    expect(mockExec).toHaveBeenCalledTimes(3);
    expect(mockClearAll).not.toHaveBeenCalled();
    expect(chrome.storage.local.remove).toHaveBeenCalledWith(StorageKeys.OPFS_FALLBACK_MODE);
    expect(mockLogWarn).toHaveBeenCalledTimes(1);
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.stringContaining('fallback migration incomplete'),
      expect.objectContaining({ migrated: 2, failed: 1, total: 3, failureReasons: ['quota exceeded'] }),
      ErrorCode.STORAGE_MIGRATION_FAILURE,
      'sqlite'
    );
  });

  it('does not clear the fallback store when every insert fails', async () => {
    mockGetAllRecords.mockResolvedValue([
      { url: 'https://bad.com', domain: 'bad.com' },
      { url: 'https://bad2.com', domain: 'bad2.com' },
    ]);
    mockExec.mockRejectedValueOnce(new Error('engine unavailable')).mockRejectedValueOnce(new Error('engine unavailable'));

    await expect(tryMigrateFallbackToSqlite({ idbEngine: {} as never })).resolves.toBeUndefined();

    expect(mockExec).toHaveBeenCalledTimes(2);
    expect(mockClearAll).not.toHaveBeenCalled();
    expect(mockLogWarn).toHaveBeenCalledTimes(1);
  });

  it('retries the retained records on the next run and clears the store once they all land', async () => {
    // First run: one insert fails and every record stays in the fallback store.
    mockGetAllRecords.mockResolvedValue([
      { url: 'https://bad.com', domain: 'bad.com' },
      { url: 'https://ok.com', domain: 'ok.com' },
      { url: 'https://ok2.com', domain: 'ok2.com' },
    ]);
    mockExec.mockRejectedValueOnce(new Error('transient failure'));

    await tryMigrateFallbackToSqlite({ idbEngine: {} as never });
    expect(mockClearAll).not.toHaveBeenCalled();

    // Second run (next launch): the store still holds all three records.
    // INSERT OR IGNORE absorbs the two rows that already landed in SQLite,
    // and clearing the store is safe again because every insert succeeded.
    await tryMigrateFallbackToSqlite({ idbEngine: {} as never });

    expect(mockExec).toHaveBeenCalledTimes(6);
    expect(mockClearAll).toHaveBeenCalledOnce();
  });
});
