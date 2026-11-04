/**
 * Import mapping pins for the session-trail columns (PBI 2026-10-22-04 O5
 * follow-up): `import` must carry nav_source_url / search_query through to
 * insertBatch, otherwise every imported row silently loses session
 * membership (toReminderCandidate drops trail-less rows) and the reminder
 * path can never fire for imported data. Both columns stay write-once —
 * NOT_UPDATABLE_COLUMNS keeps them out of every UPDATE path, so this only
 * opens the insert side, never history rewriting.
 */
import { describe, it, expect, vi } from 'vitest';
import { createMaintenanceBatchHandler } from '../maintenanceBatchHandler.js';
import type { MaintenanceBatchDeps, DepsResult } from '../deps.js';

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
  describe('import', () => {
    it('passes the session-trail columns through to insertBatch', async () => {
      const insertBatch = vi.fn(async (): Promise<BatchResult> => ({ success: true, data: { count: 1, skipped: 0 } }));
      const handler = createMaintenanceBatchHandler(makeDeps({ insertBatch }));
      const rows = [
        {
          url: 'https://example.com/target',
          title: 'Target',
          summary: 'seed',
          created_at: 1000,
          domain: 'example.com',
          scroll_ratio: 0.7,
          nav_source_url: 'https://example.com/source',
          search_query: 'wasm',
        },
      ];
      const result = await handler({ subtype: 'import', rows } as never);
      expect(result).toEqual({ success: true, inserted: 1, skipped: 0, total: 1 });
      expect(insertBatch).toHaveBeenCalledTimes(1);
      const passed = insertBatch.mock.calls[0]![0] as Array<Record<string, unknown>>;
      expect(passed).toHaveLength(1);
      expect(passed[0]!['nav_source_url']).toBe('https://example.com/source');
      expect(passed[0]!['search_query']).toBe('wasm');
    });

    it('defaults absent trail columns to null (codec stores NULL, not undefined)', async () => {
      const insertBatch = vi.fn(async (): Promise<BatchResult> => ({ success: true, data: { count: 1, skipped: 0 } }));
      const handler = createMaintenanceBatchHandler(makeDeps({ insertBatch }));
      const rows = [{ url: 'https://example.com/plain', created_at: 2000 }];
      await handler({ subtype: 'import', rows } as never);
      const passed = insertBatch.mock.calls[0]![0] as Array<Record<string, unknown>>;
      expect(passed[0]!['nav_source_url']).toBeNull();
      expect(passed[0]!['search_query']).toBeNull();
    });

    it('keeps the existing field mapping (no regression on the other columns)', async () => {
      const insertBatch = vi.fn(async (): Promise<BatchResult> => ({ success: true, data: { count: 1, skipped: 0 } }));
      const handler = createMaintenanceBatchHandler(makeDeps({ insertBatch }));
      const rows = [
        {
          url: 'https://example.com/p1',
          title: 'P1',
          summary: 's',
          tags: 'a,b',
          created_at: 3000,
          domain: 'example.com',
          visit_duration: 12,
          scroll_ratio: 0.4,
          is_starred: 1,
        },
      ];
      await handler({ subtype: 'import', rows } as never);
      const passed = insertBatch.mock.calls[0]![0] as Array<Record<string, unknown>>;
      expect(passed[0]).toMatchObject({
        url: 'https://example.com/p1',
        title: 'P1',
        summary: 's',
        tags: 'a,b',
        created_at: 3000,
        domain: 'example.com',
        visit_duration: 12,
        scroll_ratio: 0.4,
        is_starred: 1,
        is_deleted: 0,
      });
    });

    it('rejects an empty row list without calling deps', async () => {
      const insertBatch = vi.fn();
      const handler = createMaintenanceBatchHandler(makeDeps({ insertBatch }));
      const result = await handler({ subtype: 'import', rows: [] } as never);
      expect(result).toEqual({ success: false, error: 'No rows provided' });
      expect(insertBatch).not.toHaveBeenCalled();
    });
  });
});
