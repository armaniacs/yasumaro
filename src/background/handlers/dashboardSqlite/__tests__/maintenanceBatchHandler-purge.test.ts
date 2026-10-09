// @vitest-environment jsdom
/**
 * Golden parity test for the two settings-purge subtypes (purge_now /
 * content_purge_now). It pins the shared flow the refactor extracts into
 * runSettingsPurge — settings read -> both-null skip -> purge deps call ->
 * toFailure -> { success, purged, skipped } — so the extraction stays
 * behavior-preserving.
 */
import { describe, it, expect, vi } from 'vitest';
import { createMaintenanceBatchHandler } from '../maintenanceBatchHandler.js';
import { StorageKeys } from '../../../../utils/storage/types.js';
import type { MaintenanceBatchDeps, DepsResult } from '../deps.js';

type PurgeResult = DepsResult<{ purged: number }>;

function makeDeps(overrides: Partial<MaintenanceBatchDeps> = {}): MaintenanceBatchDeps {
  return {
    insert: vi.fn(),
    insertBatch: vi.fn(),
    getSettings: vi.fn(async () => ({})),
    restoreDb: vi.fn(),
    purgeOldRecords: vi.fn(async (): Promise<PurgeResult> => ({ success: true, data: { purged: 0 } })),
    purgeContent: vi.fn(async (): Promise<PurgeResult> => ({ success: true, data: { purged: 0 } })),
    backupDb: vi.fn(),
    runMigration: vi.fn(),
    runBackfill: vi.fn(),
    runCleanup: vi.fn(),
    runLegacyResync: vi.fn(),
    ...overrides,
  } as unknown as MaintenanceBatchDeps;
}

const FAILURE = {
  success: false as const,
  error: { kind: 'unknown' as const, message: 'Purge failed', retriable: false },
};

describe('maintenanceBatchHandler — purge_now', () => {
  it('skips without calling deps when both retention settings are null', async () => {
    const purgeOldRecords = vi.fn(async (): Promise<PurgeResult> => ({ success: true, data: { purged: 0 } }));
    const handler = createMaintenanceBatchHandler(makeDeps({
      getSettings: vi.fn(async () => ({})),
      purgeOldRecords,
    }));
    const result = await handler({ subtype: 'purge_now' } as never);
    expect(result).toEqual({ success: true, purged: 0, skipped: true });
    expect(purgeOldRecords).not.toHaveBeenCalled();
  });

  it('purges with days and max converted and reports purged', async () => {
    const purgeOldRecords = vi.fn(async (): Promise<PurgeResult> => ({ success: true, data: { purged: 7 } }));
    const handler = createMaintenanceBatchHandler(makeDeps({
      getSettings: vi.fn(async () => ({
        [StorageKeys.SQLITE_RETENTION_DAYS]: 30,
        [StorageKeys.SQLITE_MAX_RECORDS]: 5000,
      })),
      purgeOldRecords,
    }));
    const result = await handler({ subtype: 'purge_now' } as never);
    expect(result).toEqual({ success: true, purged: 7, skipped: false });
    expect(purgeOldRecords).toHaveBeenCalledWith(30, 5000);
  });

  it('passes undefined for the missing side (days only)', async () => {
    const purgeOldRecords = vi.fn(async (): Promise<PurgeResult> => ({ success: true, data: { purged: 1 } }));
    const handler = createMaintenanceBatchHandler(makeDeps({
      getSettings: vi.fn(async () => ({ [StorageKeys.SQLITE_RETENTION_DAYS]: 60 })),
      purgeOldRecords,
    }));
    await handler({ subtype: 'purge_now' } as never);
    expect(purgeOldRecords).toHaveBeenCalledWith(60, undefined);
  });

  it('converts a deps failure via toFailure', async () => {
    const purgeOldRecords = vi.fn(async (): Promise<PurgeResult> => FAILURE);
    const handler = createMaintenanceBatchHandler(makeDeps({
      getSettings: vi.fn(async () => ({ [StorageKeys.SQLITE_RETENTION_DAYS]: 30 })),
      purgeOldRecords,
    }));
    const result = await handler({ subtype: 'purge_now' } as never);
    expect(result).toEqual({ success: false, error: 'Purge failed', retriable: false });
  });
});

describe('maintenanceBatchHandler — content_purge_now', () => {
  it('skips without calling deps when both retention settings are null', async () => {
    const purgeContent = vi.fn(async (): Promise<PurgeResult> => ({ success: true, data: { purged: 0 } }));
    const handler = createMaintenanceBatchHandler(makeDeps({
      getSettings: vi.fn(async () => ({})),
      purgeContent,
    }));
    const result = await handler({ subtype: 'content_purge_now' } as never);
    expect(result).toEqual({ success: true, purged: 0, skipped: true });
    expect(purgeContent).not.toHaveBeenCalled();
  });

  it('purges with days, max and includeStarred and reports purged', async () => {
    const purgeContent = vi.fn(async (): Promise<PurgeResult> => ({ success: true, data: { purged: 3 } }));
    const handler = createMaintenanceBatchHandler(makeDeps({
      getSettings: vi.fn(async () => ({
        [StorageKeys.CONTENT_RETENTION_DAYS]: 14,
        [StorageKeys.CONTENT_MAX_RECORDS]: 1000,
        [StorageKeys.CONTENT_PURGE_INCLUDE_STARRED]: true,
      })),
      purgeContent,
    }));
    const result = await handler({ subtype: 'content_purge_now' } as never);
    expect(result).toEqual({ success: true, purged: 3, skipped: false });
    expect(purgeContent).toHaveBeenCalledWith(14, 1000, true);
  });

  it('defaults includeStarred to false when the setting is absent', async () => {
    const purgeContent = vi.fn(async (): Promise<PurgeResult> => ({ success: true, data: { purged: 2 } }));
    const handler = createMaintenanceBatchHandler(makeDeps({
      getSettings: vi.fn(async () => ({ [StorageKeys.CONTENT_RETENTION_DAYS]: 7 })),
      purgeContent,
    }));
    await handler({ subtype: 'content_purge_now' } as never);
    expect(purgeContent).toHaveBeenCalledWith(7, undefined, false);
  });

  it('converts a deps failure via toFailure', async () => {
    const purgeContent = vi.fn(async (): Promise<PurgeResult> => ({
      success: false,
      error: { kind: 'unknown', message: 'Content purge failed', retriable: false },
    }));
    const handler = createMaintenanceBatchHandler(makeDeps({
      getSettings: vi.fn(async () => ({ [StorageKeys.CONTENT_RETENTION_DAYS]: 7 })),
      purgeContent,
    }));
    const result = await handler({ subtype: 'content_purge_now' } as never);
    expect(result).toEqual({ success: false, error: 'Content purge failed', retriable: false });
  });
});
