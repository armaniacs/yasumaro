import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatchDashboardSqlite } from './dashboardSqliteTestHarness.js';
import { SqliteClient } from '../../sqliteClient.js';

/**
 * Step 3-0 guard tests (PBI 2026-08-09-23 Phase3).
 *
 * These subtypes previously had NO "reject without confirmToken" coverage:
 * toggle_star, update, delete, import, backfill_metadata, cleanup_legacy.
 * They are all in TOKEN_REQUIRED_SUBTYPES, so a request without a valid
 * confirmToken must be rejected at the gate — before the handler body runs.
 *
 * This is the "lock the door before refactoring" step: once the declaration
 * table drives TOKEN_REQUIRED_SUBTYPES, a mistaken `requiresToken: false`
 * for any of these would be caught here.
 */
describe('dashboardSqliteHandlers — token guard (pre-Phase3 lock-in)', () => {
  const VALID_TOKEN = 'test-valid-token-12345';
  let sqliteClient: SqliteClient;

  beforeEach(() => {
    sqliteClient = new SqliteClient();
  });

  const rejectWithoutToken = (subtype: string, depsMethod: string, mockImpl: () => unknown) => {
    (sqliteClient as unknown as Record<string, ReturnType<typeof vi.fn>>)[depsMethod] =
      vi.fn().mockImplementation(mockImpl);
  };

  it.each([
    ['toggle_star', 'toggleStarResult', () => ({ success: true, data: { is_starred: 1 } })],
    ['update', 'updateResult', () => ({ success: true, data: undefined })],
    ['delete', 'deleteResult', () => ({ success: true, data: undefined })],
    ['import', 'insertResult', () => ({ success: true, data: { id: 1 } })],
    ['backfill_metadata', 'runBackfill', () => ({ updated: 0, total: 0 })],
    ['cleanup_legacy', 'runCleanup', () => ({ removed: [], totalBytes: 0 })],
  ])('rejects %s without confirmToken and never reaches the handler', async (subtype, depsMethod, mockImpl) => {
    rejectWithoutToken(subtype, depsMethod, mockImpl as () => unknown);

    const result = await dispatchDashboardSqlite(
      { subtype } as never,
      sqliteClient,
      { getConfirmToken: async () => VALID_TOKEN },
    );

    expect(result).toEqual({ success: false, error: 'Confirmation token mismatch' });
    expect((sqliteClient as unknown as Record<string, ReturnType<typeof vi.fn>>)[depsMethod]).not.toHaveBeenCalled();
  });
});
