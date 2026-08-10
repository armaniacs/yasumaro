import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatchDashboardSqlite } from './dashboardSqliteTestHarness.js';
import { SqliteClient } from '../../sqliteClient.js';
import {
  TOKEN_REQUIRED_SUBTYPES,
  TOKEN_EXEMPT_OPS,
  READ_ONLY_OPS,
  type DashboardSqliteSubtype,
} from '../../../messaging/sqliteOperationSecurity.js';

/**
 * Step 3-0 guard tests (PBI 2026-08-09-23 Phase3).
 *
 * These tests are DATA-DRIVEN over the derived `TOKEN_REQUIRED_SUBTYPES`
 * (see dev-docs/plans/2026-08-09-pbi23-phase3-senior-consultation.md §10.6):
 * adding a destructive operation to the exempt allowlist automatically pulls it
 * out of the required set, and any operation left in the required set is
 * asserted to reject without a token. This catches a mistaken
 * `requiresToken: false` (silent guard bypass) at the test layer.
 */

// Mock impls for the deps methods each required op would invoke, used to assert
// the gate blocks before the handler body runs.
const DEPS_MOCKS: Partial<Record<DashboardSqliteSubtype, () => unknown>> = {
  toggle_star: () => ({ success: true, data: { is_starred: 1 } }),
  update: () => ({ success: true, data: undefined }),
  delete: () => ({ success: true, data: undefined }),
  migrate: () => ({ success: true, count: 0, read: 0, inserted: 0 }),
  clear_all: () => ({ success: true, data: undefined }),
  backfill_metadata: () => ({ updated: 0, total: 0 }),
  cleanup_legacy: () => ({ removed: [], totalBytes: 0 }),
  backup_db: () => ({ success: true, data: new Uint8Array() }),
  restore_db: () => ({ success: true, data: undefined }),
  import: () => ({ success: true, data: { id: 1 } }),
  append_to_obsidian: () => ({ success: true, data: { rows: [], total: 0 } }),
  purge_now: () => ({ success: true, data: { purged: 0 } }),
  content_purge_now: () => ({ success: true, data: { purged: 0 } }),
};

// Map subtypes to the SqliteClient method the handler would call.
const DEPS_METHOD: Partial<Record<DashboardSqliteSubtype, string>> = {
  toggle_star: 'toggleStarResult',
  update: 'updateResult',
  delete: 'deleteResult',
  migrate: 'runMigration',
  clear_all: 'clearAllResult',
  backfill_metadata: 'runBackfill',
  cleanup_legacy: 'runCleanup',
  backup_db: 'backupDbResult',
  restore_db: 'restoreDbResult',
  import: 'insertResult',
  append_to_obsidian: 'queryResult',
  purge_now: 'purgeOldRecordsResult',
  content_purge_now: 'purgeContentResult',
};

describe('dashboardSqliteHandlers — token guard (data-driven)', () => {
  const VALID_TOKEN = 'test-valid-token-12345';
  let sqliteClient: SqliteClient;

  beforeEach(() => {
    sqliteClient = new SqliteClient();
  });

  const requiredSubtypes = [...TOKEN_REQUIRED_SUBTYPES] as DashboardSqliteSubtype[];

  it.each(requiredSubtypes)(
    'rejects %s without confirmToken and never reaches the handler',
    async (subtype) => {
      const method = DEPS_METHOD[subtype];
      const mock = DEPS_MOCKS[subtype];
      if (method) {
        (sqliteClient as unknown as Record<string, ReturnType<typeof vi.fn>>)[method] =
          vi.fn().mockImplementation(mock as () => unknown);
      }

      const result = await dispatchDashboardSqlite(
        { subtype } as never,
        sqliteClient,
        { getConfirmToken: async () => VALID_TOKEN },
      );

      expect(result).toEqual({ success: false, error: 'Confirmation token mismatch' });
      if (method) {
        expect((sqliteClient as unknown as Record<string, ReturnType<typeof vi.fn>>)[method]).not.toHaveBeenCalled();
      }
    },
  );

  it('allows a read-only (exempt) subtype without confirmToken', async () => {
    (sqliteClient as unknown as Record<string, ReturnType<typeof vi.fn>>)['queryResult'] =
      vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } });

    const result = await dispatchDashboardSqlite(
      { subtype: 'query' },
      sqliteClient,
      { getConfirmToken: async () => VALID_TOKEN },
    );

    expect(result).toMatchObject({ success: true });
  });
});

describe('sqliteOperationSecurity — allowlist integrity', () => {
  it('every token-exempt op is a read-only op (guards against exempting a destructive op)', () => {
    for (const op of TOKEN_EXEMPT_OPS) {
      expect(READ_ONLY_OPS.has(op)).toBe(true);
    }
  });

  it('exempt and required sets partition all subtypes with no overlap', () => {
    const exempt: Set<DashboardSqliteSubtype> = new Set(TOKEN_EXEMPT_OPS);
    for (const op of TOKEN_REQUIRED_SUBTYPES) {
      expect(exempt.has(op)).toBe(false);
    }
  });
});
