// @vitest-environment jsdom
/**
 * Entry-level purge planning tests (PBI 2026-10-16-11).
 *
 * The background settings path used to coerce retention values with Number()
 * and pass them straight to deps, so garbage (NaN / negative / fraction /
 * numeric string / boolean) reached the offscreen trust boundary with a
 * different reading than planPurge. These tests pin the handler entry:
 * garbage fail-closes without calling deps, and `0` normalizes to
 * "skip this dimension" (undefined) exactly like the planner.
 */
import { describe, it, expect, vi } from 'vitest';
import { createMaintenanceBatchHandler } from '../maintenanceBatchHandler.js';
import { StorageKeys } from '../../../../utils/storage/types.js';
import type { MaintenanceBatchDeps, DepsResult } from '../deps.js';
// Test-only cross-layer import (bans ignore __tests__): the planner owns the
// contract, the handler mirrors it — drift fails here.
import { planSettingsPurge as canonicalPlanSettingsPurge } from '../../../../offscreen/queryPlanner.js';

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

describe('maintenanceBatchHandler — purge entry planning (PBI 2026-10-16-11)', () => {
  it.each([Number('abc'), -1, 0.5, Number.POSITIVE_INFINITY, '30', true])(
    'purge_now fail-closes on %s without calling deps',
    async (raw) => {
      const purgeOldRecords = vi.fn(async (): Promise<PurgeResult> => ({ success: true, data: { purged: 0 } }));
      const handler = createMaintenanceBatchHandler(makeDeps({
        getSettings: vi.fn(async () => ({ [StorageKeys.SQLITE_RETENTION_DAYS]: raw })),
        purgeOldRecords,
      }));
      const result = await handler({ subtype: 'purge_now' } as never);
      expect(result).toEqual(expect.objectContaining({ success: false, error: expect.stringContaining('retentionDays') }));
      expect(purgeOldRecords).not.toHaveBeenCalled();
    },
  );

  it('purge_now normalizes 0 to undefined (skip this dimension)', async () => {
    const purgeOldRecords = vi.fn(async (): Promise<PurgeResult> => ({ success: true, data: { purged: 0 } }));
    const handler = createMaintenanceBatchHandler(makeDeps({
      getSettings: vi.fn(async () => ({
        [StorageKeys.SQLITE_RETENTION_DAYS]: 0,
        [StorageKeys.SQLITE_MAX_RECORDS]: 0,
      })),
      purgeOldRecords,
    }));
    const result = await handler({ subtype: 'purge_now' } as never);
    expect(result).toEqual({ success: true, purged: 0, skipped: false });
    expect(purgeOldRecords).toHaveBeenCalledWith(undefined, undefined);
  });

  it('content_purge_now fail-closes on garbage maxRecords without calling deps', async () => {
    const purgeContent = vi.fn(async (): Promise<PurgeResult> => ({ success: true, data: { purged: 0 } }));
    const handler = createMaintenanceBatchHandler(makeDeps({
      getSettings: vi.fn(async () => ({ [StorageKeys.CONTENT_MAX_RECORDS]: '1000' })),
      purgeContent,
    }));
    const result = await handler({ subtype: 'content_purge_now' } as never);
    expect(result).toEqual(expect.objectContaining({ success: false, error: expect.stringContaining('maxRecords') }));
    expect(purgeContent).not.toHaveBeenCalled();
  });

  it('content_purge_now normalizes a non-boolean includeStarred to false', async () => {
    const purgeContent = vi.fn(async (): Promise<PurgeResult> => ({ success: true, data: { purged: 1 } }));
    const handler = createMaintenanceBatchHandler(makeDeps({
      getSettings: vi.fn(async () => ({
        [StorageKeys.CONTENT_RETENTION_DAYS]: 7,
        [StorageKeys.CONTENT_PURGE_INCLUDE_STARRED]: 'yes',
      })),
      purgeContent,
    }));
    await handler({ subtype: 'content_purge_now' } as never);
    expect(purgeContent).toHaveBeenCalledWith(7, undefined, false);
  });

  it.each([
    [{}, 'skip'],
    [{ [StorageKeys.SQLITE_RETENTION_DAYS]: 30, [StorageKeys.SQLITE_MAX_RECORDS]: 5000 }, 'call'],
    [{ [StorageKeys.SQLITE_RETENTION_DAYS]: 0, [StorageKeys.SQLITE_MAX_RECORDS]: 0 }, 'call'],
    [{ [StorageKeys.SQLITE_RETENTION_DAYS]: Number('abc') }, 'fail'],
    [{ [StorageKeys.SQLITE_MAX_RECORDS]: '1000' }, 'fail'],
  ])('mirrors the planner for settings case %#', async (settings, expected) => {
    const planned = canonicalPlanSettingsPurge(
      settings as Record<string, unknown>,
      StorageKeys.SQLITE_RETENTION_DAYS,
      StorageKeys.SQLITE_MAX_RECORDS,
    );
    const purgeOldRecords = vi.fn(async (): Promise<PurgeResult> => ({ success: true, data: { purged: 0 } }));
    const handler = createMaintenanceBatchHandler(makeDeps({
      getSettings: vi.fn(async () => settings),
      purgeOldRecords,
    }));
    const result = await handler({ subtype: 'purge_now' } as never);
    if ('skip' in planned) {
      expect(expected).toBe('skip');
      expect(result).toEqual({ success: true, purged: 0, skipped: true });
      expect(purgeOldRecords).not.toHaveBeenCalled();
    } else if (!planned.ok) {
      expect(expected).toBe('fail');
      expect(result).toEqual(expect.objectContaining({ success: false }));
      expect(purgeOldRecords).not.toHaveBeenCalled();
    } else {
      expect(expected).toBe('call');
      expect(purgeOldRecords).toHaveBeenCalledWith(planned.retentionDays, planned.maxRecords);
    }
  });
});
