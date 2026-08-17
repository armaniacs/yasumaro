// @vitest-environment jsdom
/**
 * Unit tests for fallbackMigration.ts (PBI-01 extraction).
 * Covers FallbackStorage -> IDB migration and the OPFS_FALLBACK_MODE flag
 * clearing behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StorageKeys } from '../../../utils/storage/types.js';

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

const { tryMigrateFallbackToSqlite } = await import('../fallbackMigration.js');

describe('fallbackMigration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllRecords.mockResolvedValue([]);
    globalThis.chrome = {
      storage: { local: { remove: vi.fn().mockResolvedValue(undefined) } },
    } as unknown as typeof chrome;
  });

  it('レコードが無い場合は何もマイグレーションせず OPFS_FALLBACK_MODE を解除する', async () => {
    await tryMigrateFallbackToSqlite({ idbEngine: {} as never });

    expect(mockExec).not.toHaveBeenCalled();
    expect(chrome.storage.local.remove).toHaveBeenCalledWith(StorageKeys.OPFS_FALLBACK_MODE);
  });

  it('idbEngine が無い場合はマイグレーションをスキップする', async () => {
    mockGetAllRecords.mockResolvedValue([{ url: 'https://example.com', domain: null }]);

    await tryMigrateFallbackToSqlite({ idbEngine: null });

    expect(mockExec).not.toHaveBeenCalled();
  });

  it('レコードを INSERT OR IGNORE で移行し、成功したら fallback をクリアする', async () => {
    mockGetAllRecords.mockResolvedValue([
      { url: 'https://example.com', domain: null },
      { url: 'https://foo.com', domain: 'foo.com' },
    ]);

    await tryMigrateFallbackToSqlite({ idbEngine: {} as never });

    expect(mockExec).toHaveBeenCalledTimes(2);
    expect(mockClearAll).toHaveBeenCalledOnce();
    expect(chrome.storage.local.remove).toHaveBeenCalledWith(StorageKeys.OPFS_FALLBACK_MODE);
  });

  it('個別レコードの insert 失敗はスキップし、他のレコードの移行を継続する', async () => {
    mockGetAllRecords.mockResolvedValue([
      { url: 'https://bad.com', domain: 'bad.com' },
      { url: 'https://ok.com', domain: 'ok.com' },
    ]);
    mockExec.mockRejectedValueOnce(new Error('constraint violation')).mockResolvedValueOnce(undefined);

    await expect(tryMigrateFallbackToSqlite({ idbEngine: {} as never })).resolves.toBeUndefined();

    expect(mockExec).toHaveBeenCalledTimes(2);
    expect(mockClearAll).toHaveBeenCalledOnce();
  });
});
