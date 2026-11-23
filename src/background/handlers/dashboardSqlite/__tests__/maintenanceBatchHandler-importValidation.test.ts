/**
 * maintenanceBatchHandler-importValidation.test.ts (PBI 2026-11-08-06)
 *
 * The import case used to map every row into insertBatch without looking at
 * the values, so one mistyped row failed the whole batch at the SQL layer.
 * Invalid rows are now filtered: valid rows still import, `total` stays the
 * original count (rejected = total - inserted - skipped), and an all-invalid
 * batch is rejected without touching deps.
 */
import { describe, it, expect, vi } from 'vitest';
import { createMaintenanceBatchHandler } from '../maintenanceBatchHandler.js';
import type { MaintenanceBatchDeps, DepsResult } from '../deps.js';
import { logWarn } from '../../../../utils/logger/api.js';

vi.mock('../../../../utils/logger/api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../utils/logger/api.js')>();
  return { ...actual, logWarn: vi.fn(actual.logWarn) };
});

const mockLogWarn = vi.mocked(logWarn);

type BatchResult = DepsResult<{ count: number; skipped: number }>;

function makeDeps(overrides: Partial<MaintenanceBatchDeps> = {}): MaintenanceBatchDeps {
  return {
    insert: vi.fn(),
    insertBatch: vi.fn(async (): Promise<BatchResult> => ({ success: true, data: { count: 1, skipped: 0 } })),
    getSettings: vi.fn(async () => ({})),
    restoreDb: vi.fn(),
    purgeOldRecords: vi.fn(),
    purgeContent: vi.fn(),
    backupDb: vi.fn(),
    runMigration: vi.fn(),
    runBackfill: vi.fn(),
    runCleanup: vi.fn(),
    runLegacyResync: vi.fn(),
    ...overrides,
  } as unknown as MaintenanceBatchDeps;
}

describe('maintenanceBatchHandler', () => {
  describe('import row validation', () => {
    it('filters invalid rows and still imports the valid ones', async () => {
      const insertBatch = vi.fn(async (..._args: unknown[]): Promise<BatchResult> => ({ success: true, data: { count: 2, skipped: 0 } }));
      const handler = createMaintenanceBatchHandler(makeDeps({ insertBatch }));
      const rows = [
        { url: 'https://example.com/ok1', created_at: 1000 },
        { url: 'https://example.com/bad', created_at: 1001, scroll_ratio: 5 },
        { created_at: 1002 },
        { url: 'https://example.com/ok2', created_at: 1003 },
      ];
      const result = await handler({ subtype: 'import', rows } as never);
      expect(result).toEqual({ success: true, inserted: 2, skipped: 0, total: 4 });
      expect(insertBatch).toHaveBeenCalledTimes(1);
      const sent = insertBatch.mock.calls[0]![0] as Array<{ url: string }>;
      expect(sent.map((r) => r.url)).toEqual(['https://example.com/ok1', 'https://example.com/ok2']);
    });

    it('rejects an all-invalid batch without calling deps', async () => {
      const insertBatch = vi.fn();
      const handler = createMaintenanceBatchHandler(makeDeps({ insertBatch }));
      const result = await handler({ subtype: 'import', rows: [{ created_at: 1 }] } as never);
      expect(result).toEqual({ success: false, error: 'No valid rows provided' });
      expect(insertBatch).not.toHaveBeenCalled();
    });

    it('imports a fully valid batch unchanged', async () => {
      const insertBatch = vi.fn(async (): Promise<BatchResult> => ({ success: true, data: { count: 1, skipped: 0 } }));
      const handler = createMaintenanceBatchHandler(makeDeps({ insertBatch }));
      const result = await handler({ subtype: 'import', rows: [{ url: 'https://a.com', created_at: 1 }] } as never);
      expect(result).toEqual({ success: true, inserted: 1, skipped: 0, total: 1 });
      expect(insertBatch).toHaveBeenCalledTimes(1);
    });

    it('logs a WARN with the excluded count and capped reasons when rows are filtered', async () => {
      mockLogWarn.mockClear();
      const insertBatch = vi.fn(async (): Promise<BatchResult> => ({ success: true, data: { count: 1, skipped: 0 } }));
      const handler = createMaintenanceBatchHandler(makeDeps({ insertBatch }));
      const rows = [
        { url: 'https://example.com/ok', created_at: 1000 },
        { url: 'https://example.com/bad', created_at: 1001, scroll_ratio: 5 },
        { created_at: 1002 },
      ];
      await handler({ subtype: 'import', rows } as never);
      expect(mockLogWarn).toHaveBeenCalledTimes(1);
      const [message, details] = mockLogWarn.mock.calls[0] as [string, Record<string, unknown>];
      expect(message).toContain('excluded invalid rows');
      expect(details['excluded']).toBe(2);
      expect(details['total']).toBe(3);
      expect((details['reasons'] as unknown[]).length).toBeLessThanOrEqual(5);
    });

    it('stays silent when nothing is excluded', async () => {
      mockLogWarn.mockClear();
      const insertBatch = vi.fn(async (): Promise<BatchResult> => ({ success: true, data: { count: 1, skipped: 0 } }));
      const handler = createMaintenanceBatchHandler(makeDeps({ insertBatch }));
      await handler({ subtype: 'import', rows: [{ url: 'https://a.com', created_at: 1 }] } as never);
      expect(mockLogWarn).not.toHaveBeenCalled();
    });
  });
});
