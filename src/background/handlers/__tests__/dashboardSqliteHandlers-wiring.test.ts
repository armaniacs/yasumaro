import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../utils/logger.js', () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  ErrorCode: { UNKNOWN_ERROR: 'UNKNOWN_ERROR', INTERNAL_ERROR: 'INTERNAL_ERROR' },
}));

vi.mock('../../../utils/errorUtils.js', () => ({
  errorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

vi.mock('../../../utils/storage.js', () => ({
  StorageKeys: {
    OBSIDIAN_API_KEY: 'obsidian_api_key',
    SQLITE_RETENTION_DAYS: 'sqlite_retention_days',
    SQLITE_MAX_RECORDS: 'sqlite_max_records',
    CONTENT_RETENTION_DAYS: 'content_retention_days',
    CONTENT_MAX_RECORDS: 'content_max_records',
    CONTENT_PURGE_INCLUDE_STARRED: 'content_purge_include_starred',
  },
  getSettings: vi.fn().mockResolvedValue({}),
  DEFAULT_SETTINGS: {},
  API_KEY_FIELDS: [],
}));

import { createDashboardSqliteHandler, createSqliteClientDeps } from '../dashboardSqliteHandlers.js';
import type { SqliteClientBackedDeps } from '../dashboardSqliteHandlers.js';
import type { SqliteClient } from '../../sqliteClient.js';

function makeSqliteClient(overrides: Record<string, unknown> = {}) {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    search: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    toggleStar: vi.fn().mockResolvedValue({ is_starred: 1 }),
    delete: vi.fn().mockResolvedValue(true),
    update: vi.fn().mockResolvedValue(true),
    getCount: vi.fn().mockResolvedValue(7),
    clearAll: vi.fn().mockResolvedValue(true),
    insert: vi.fn().mockResolvedValue({ id: 1 }),
    restoreDb: vi.fn().mockResolvedValue(true),
    getStatus: vi.fn().mockResolvedValue({ initialized: true }),
    runOpfsSpike: vi.fn().mockResolvedValue({}),
    purgeOldRecords: vi.fn().mockResolvedValue({ purged: 0 }),
    purgeContent: vi.fn().mockResolvedValue({ purged: 0 }),
    backupDb: vi.fn().mockResolvedValue(new Uint8Array([1])),
    queryAuditLog: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    lastError: null,
    ...overrides,
  } as unknown as SqliteClient;
}

const TOKEN = 'test-confirm-token';

function makeServiceWorkerDeps(overrides: Partial<SqliteClientBackedDeps> = {}): SqliteClientBackedDeps {
  return {
    runMigration: vi.fn().mockResolvedValue({ success: true, count: 0 }),
    getConfirmToken: vi.fn().mockResolvedValue(TOKEN),
    runBackfill: vi.fn().mockResolvedValue({ updated: 0, total: 0 }),
    runCleanup: vi.fn().mockResolvedValue({ removed: [], totalBytes: 0 }),
    ...overrides,
  };
}

/**
 * These cover the four dependencies the Service Worker owns. The former
 * test-only wrapper replaced all of them with stubs, so no test reached the
 * behaviour that actually ships.
 */
describe('dashboard SQLite wiring — Service-Worker-owned dependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('migrate', () => {
    it('reports the migration result', async () => {
      const runMigration = vi.fn().mockResolvedValue({ success: true, count: 42, read: 5, inserted: 37 });
      const handler = createDashboardSqliteHandler(
        createSqliteClientDeps(makeSqliteClient(), makeServiceWorkerDeps({ runMigration })),
      );

      const result = await handler({ subtype: 'migrate', confirmToken: TOKEN });

      expect(runMigration).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ success: true, count: 42, read: 5, inserted: 37, error: undefined });
    });

    it('reports a migration failure', async () => {
      const runMigration = vi.fn().mockResolvedValue({ success: false, count: 0, error: 'migration exploded' });
      const handler = createDashboardSqliteHandler(
        createSqliteClientDeps(makeSqliteClient(), makeServiceWorkerDeps({ runMigration })),
      );

      expect(await handler({ subtype: 'migrate', confirmToken: TOKEN })).toEqual({ success: false, error: 'migration exploded' });
    });
  });

  describe('confirm token', () => {
    it('returns the token issued by the Service Worker', async () => {
      const getConfirmToken = vi.fn().mockResolvedValue('sw-issued-token');
      const handler = createDashboardSqliteHandler(
        createSqliteClientDeps(makeSqliteClient(), makeServiceWorkerDeps({ getConfirmToken })),
      );

      expect(await handler({ subtype: 'confirm_token' })).toEqual({
        success: true,
        confirmToken: 'sw-issued-token',
      });
    });

    it('rejects a destructive subtype when the token does not match', async () => {
      const client = makeSqliteClient();
      const handler = createDashboardSqliteHandler(
        createSqliteClientDeps(client, makeServiceWorkerDeps()),
      );

      const result = await handler({ subtype: 'clear_all', confirmToken: 'wrong-token' });

      expect(result).toEqual({ success: false, error: 'Confirmation token mismatch' });
      expect(client.clearAll).not.toHaveBeenCalled();
    });

    it('rejects a destructive subtype when no token is supplied', async () => {
      const client = makeSqliteClient();
      const handler = createDashboardSqliteHandler(
        createSqliteClientDeps(client, makeServiceWorkerDeps()),
      );

      expect(await handler({ subtype: 'clear_all' })).toEqual({
        success: false,
        error: 'Confirmation token mismatch',
      });
      expect(client.clearAll).not.toHaveBeenCalled();
    });

    it('allows a destructive subtype when the token matches', async () => {
      const client = makeSqliteClient();
      const handler = createDashboardSqliteHandler(
        createSqliteClientDeps(client, makeServiceWorkerDeps()),
      );

      expect(await handler({ subtype: 'clear_all', confirmToken: TOKEN })).toEqual({ success: true });
      expect(client.clearAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('backfill / cleanup', () => {
    it('returns the backfill counts', async () => {
      const runBackfill = vi.fn().mockResolvedValue({ updated: 12, total: 30 });
      const handler = createDashboardSqliteHandler(
        createSqliteClientDeps(makeSqliteClient(), makeServiceWorkerDeps({ runBackfill })),
      );

      expect(await handler({ subtype: 'backfill_metadata', confirmToken: TOKEN })).toEqual({ success: true, updated: 12, total: 30 });
    });

    it('reports a backfill failure instead of throwing', async () => {
      const runBackfill = vi.fn().mockRejectedValue(new Error('nope'));
      const handler = createDashboardSqliteHandler(
        createSqliteClientDeps(makeSqliteClient(), makeServiceWorkerDeps({ runBackfill })),
      );

      expect(await handler({ subtype: 'backfill_metadata', confirmToken: TOKEN })).toEqual({
        success: false,
        error: 'Backfill not available',
      });
    });

    it('returns what the cleanup removed', async () => {
      const runCleanup = vi.fn().mockResolvedValue({ removed: ['legacy_key'], totalBytes: 2048 });
      const handler = createDashboardSqliteHandler(
        createSqliteClientDeps(makeSqliteClient(), makeServiceWorkerDeps({ runCleanup })),
      );

      expect(await handler({ subtype: 'cleanup_legacy', confirmToken: TOKEN })).toEqual({
        success: true,
        removed: ['legacy_key'],
        totalBytes: 2048,
      });
    });
  });

  describe('SqliteClient-backed operations', () => {
    it('routes reads to the client', async () => {
      const client = makeSqliteClient();
      const handler = createDashboardSqliteHandler(createSqliteClientDeps(client, makeServiceWorkerDeps()));

      expect(await handler({ subtype: 'get_count' })).toEqual({ success: true, count: 7 });
      expect(client.getCount).toHaveBeenCalledTimes(1);
    });

    it('surfaces the categorized client error through the shared wiring', async () => {
      const client = makeSqliteClient({
        query: vi.fn().mockResolvedValue(null),
        lastError: 'Storage quota exceeded.',
      });
      const handler = createDashboardSqliteHandler(createSqliteClientDeps(client, makeServiceWorkerDeps()));

      expect(await handler({ subtype: 'query' })).toEqual({
        success: false,
        error: 'Storage quota exceeded.',
      });
    });
  });
});
