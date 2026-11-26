import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatchDashboardSqlite } from '../handlers/__tests__/dashboardSqliteTestHarness.js';
import { createDashboardSqliteHandler } from '../handlers/dashboardSqliteHandlers.js';
import type { DashboardSqliteHandlerDeps } from '../handlers/dashboardSqliteHandlers.js';
import { SqliteClient } from '../sqlite/offscreenGateway.js';

/** Minimal full DashboardSqliteHandlerDeps stub, only `search` overridden per test. */
function makeBaseDeps(overrides: Partial<DashboardSqliteHandlerDeps> = {}): DashboardSqliteHandlerDeps {
  return {
    query: async () => ({ success: true, data: { rows: [], total: 0 } }),
    search: async () => ({ success: true, data: { rows: [], total: 0 } }),
    toggleStar: async () => ({ success: true, data: { is_starred: 0 } }),
    delete: async () => ({ success: true, data: undefined }),
    update: async () => ({ success: true, data: undefined }),
    getCount: async () => ({ success: true, data: 0 }),
    clearAll: async () => ({ success: true, data: undefined }),
    insert: async () => ({ success: true, data: { id: 1 } }),
    insertBatch: async (records: Record<string, unknown>[]) => ({ success: true, data: { count: records.length, skipped: 0 } }),
    getSettings: async () => ({}),
    // PBI 2026-10-19-11: the append path re-reads consent before exporting.
    isConsentGranted: async () => true,
    formatEntriesToMarkdown: () => null,
    appendToDailyNote: async () => {},
    restoreBegin: async () => ({ success: true, data: 'restore_incoming_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db' }),
    restoreAppendChunk: async () => ({ success: true, data: 1 }),
    restoreCommit: async () => ({ success: true, data: undefined }),
    restoreAbort: async () => ({ success: true, data: undefined }),
    getStatus: async () => null,
    purgeOldRecords: async () => ({ success: true, data: { purged: 0 } }),
    purgeContent: async () => ({ success: true, data: { purged: 0 } }),
    backupDb: async () => ({ success: true, data: new Uint8Array() }),
    runMigration: async () => ({ success: false, error: 'n/a', count: 0, read: 0, inserted: 0 }),
    createConfirmToken: async () => '',
    verifyConfirmToken: async (token: string) => token === '',
    runBackfill: async () => ({ updated: 0, total: 0 }),
    runCleanup: async () => ({ removed: [], totalBytes: 0 }),
    runLegacyResync: async () => ({ examined: 0, written: 0, skipped: 0, total: 0 }),
    queryAuditLog: async () => ({ success: true, data: { rows: [], total: 0 } }),
    // Archive-group deps are unused by these tests (only query/search paths run).
    ...archiveDepStubs(),
    ...overrides,
  };
}

function archiveDepStubs(): Pick<
  DashboardSqliteHandlerDeps,
    | 'archivePreview' | 'archiveCreate' | 'archiveCleanup' | 'archiveExportChunk'
    | 'archivePrepareIncoming' | 'archiveRestorePreview' | 'archiveRestore'
    | 'archiveDeleteByStaging' | 'archiveOpen' | 'archiveQuery' | 'archiveUpdate'
    | 'archiveSave' | 'archiveClose' | 'archiveStatus'
> {
  const notImpl = async (): Promise<never> => {
    throw new Error('archive dep not stubbed for this test');
  };
  return {
    archivePreview: notImpl,
    archiveCreate: notImpl,
    archiveCleanup: notImpl,
    archiveExportChunk: notImpl,
    archivePrepareIncoming: notImpl,
    archiveRestorePreview: notImpl,
    archiveRestore: notImpl,
    archiveDeleteByStaging: notImpl,
    archiveOpen: notImpl,
    archiveQuery: notImpl,
    archiveUpdate: notImpl,
    archiveSave: notImpl,
    archiveClose: notImpl,
    archiveStatus: notImpl,
  };
}

describe('dashboardSqliteHandlers — confirmation token (H2)', () => {
  let sqliteClient: SqliteClient;
  const VALID_TOKEN = 'test-valid-token-12345';
  const INVALID_TOKEN = 'wrong-token';

  beforeEach(() => {
    sqliteClient = {
      query: vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } }),
      mutate: vi.fn().mockResolvedValue({ success: true, data: undefined }),
      maintain: vi.fn().mockResolvedValue({ success: true, data: undefined }),
      getStatus: vi.fn().mockResolvedValue(null),
    } as any;
  });

  it('rejects clear_all without confirmToken', async () => {
    const result = await dispatchDashboardSqlite(
      { subtype: 'clear_all' },
      sqliteClient,
      { getConfirmToken: async () => VALID_TOKEN }
    );
    expect(result).toEqual({ success: false, error: expect.stringContaining('token') });
    expect((sqliteClient as unknown as { maintain: ReturnType<typeof vi.fn> }).maintain).not.toHaveBeenCalled();
  });

  it('rejects clear_all with invalid confirmToken', async () => {
    const result = await dispatchDashboardSqlite(
      { subtype: 'clear_all', confirmToken: INVALID_TOKEN },
      sqliteClient,
      { getConfirmToken: async () => VALID_TOKEN }
    );
    expect(result).toEqual({ success: false, error: expect.stringContaining('token') });
  });

  it('accepts clear_all with valid confirmToken', async () => {
    const result = await dispatchDashboardSqlite(
      { subtype: 'clear_all', confirmToken: VALID_TOKEN },
      sqliteClient,
      { getConfirmToken: async () => VALID_TOKEN }
    );
    expect(result).toEqual({ success: true });
    expect((sqliteClient as unknown as { maintain: ReturnType<typeof vi.fn> }).maintain).toHaveBeenCalled();
  });

  it('rejects migrate without confirmToken', async () => {
    const result = await dispatchDashboardSqlite(
      { subtype: 'migrate' },
      sqliteClient,
      {
        runMigration: async () => ({ success: true, count: 0, read: 0, inserted: 0 }),
        getConfirmToken: async () => VALID_TOKEN,
      }
    );
    expect(result).toEqual({ success: false, error: expect.stringContaining('token') });
  });

  it('allows query without confirmToken (read-only)', async () => {
    // Stub query: the read path calls query
    // each failure's reason stays attached to the call that produced it.
    (sqliteClient as unknown as { query: ReturnType<typeof vi.fn> }).query =
      vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } });
    const result = await dispatchDashboardSqlite(
      { subtype: 'query' },
      sqliteClient,
      { getConfirmToken: async () => VALID_TOKEN }
    );
    expect(result).toMatchObject({ success: true });
  });

  it('wraps search results with success:true (regression: dashboard search showed load error)', async () => {
    // query search resolves to a CallResult carrying { rows, total }. The
    // handler must unwrap it and add success:true so the dashboard service does
    // not treat a valid result as a failure ("データの読み込みに失敗しました").
    const rows = [{ id: 1, url: 'https://a.com', title: 'kddi', rank: -1 }];
    (sqliteClient as unknown as { query: ReturnType<typeof vi.fn> }).query =
      vi.fn().mockResolvedValue({ success: true, data: { rows, total: 1 } });
    const result = await dispatchDashboardSqlite(
      { subtype: 'search', query: 'kddi' },
      sqliteClient,
      { getConfirmToken: async () => VALID_TOKEN }
    );
    expect(result).toEqual({ success: true, rows, total: 1 });
  });

  it('returns success:false when search yields an error', async () => {
    (sqliteClient as unknown as { query: ReturnType<typeof vi.fn> }).query =
      vi.fn().mockResolvedValue({ success: false, error: { kind: 'unknown', message: 'Search failed', retriable: false } });
    const result = await dispatchDashboardSqlite(
      { subtype: 'search', query: 'kddi' },
      sqliteClient,
      { getConfirmToken: async () => VALID_TOKEN }
    );
    expect(result).toMatchObject({ success: false });
  });

  it('passes orderBy/orderDir through to deps.search', async () => {
    const search = vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } });
    const handler = createDashboardSqliteHandler(makeBaseDeps({ search }));
    await handler({ subtype: 'search', query: 'kddi', limit: 20, offset: 0, orderBy: 'created_at', orderDir: 'ASC' });
    expect(search).toHaveBeenCalledWith('kddi', 20, 0, { orderBy: 'created_at', orderDir: 'ASC' });
  });
});

describe('restore session subtypes (chunked staging transport)', () => {
  let sqliteClient: Record<string, unknown>;
  const VALID_TOKEN = 'test-valid-token-12345';
  const STAGING = 'restore_incoming_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db';

  beforeEach(() => {
    sqliteClient = {
      maintain: vi.fn().mockResolvedValue({ success: true, data: undefined }),
      query: vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } }),
      mutate: vi.fn().mockResolvedValue({ success: true, data: undefined }),
      getStatus: vi.fn().mockResolvedValue(null),
    };
  });

  it('rejects restore_commit without a valid confirmToken and never reaches the staging', async () => {
    const result = await dispatchDashboardSqlite(
      { subtype: 'restore_commit', stagingName: STAGING, totalBytes: 10 },
      sqliteClient,
      { getConfirmToken: async () => VALID_TOKEN }
    );

    expect(result).toEqual({ success: false, error: expect.stringContaining('token') });
    expect((sqliteClient as unknown as { maintain: ReturnType<typeof vi.fn> }).maintain).not.toHaveBeenCalled();
  });

  it('routes restore_begin to the maintain gateway with the session declaration', async () => {
    (sqliteClient as unknown as { maintain: ReturnType<typeof vi.fn> }).maintain =
      vi.fn().mockResolvedValue({ success: true, data: STAGING });
    const result = await dispatchDashboardSqlite(
      { subtype: 'restore_begin', totalBytes: 8, totalChunks: 1, confirmToken: VALID_TOKEN },
      sqliteClient,
      { getConfirmToken: async () => VALID_TOKEN }
    );

    expect(result).toEqual({ success: true, stagingName: STAGING });
    expect((sqliteClient as unknown as { maintain: ReturnType<typeof vi.fn> }).maintain)
      .toHaveBeenCalledWith({ type: 'restorePrepareIncoming', totalBytes: 8, totalChunks: 1 });
  });

  it('routes restore_chunk to the maintain gateway with base64 passthrough', async () => {
    (sqliteClient as unknown as { maintain: ReturnType<typeof vi.fn> }).maintain =
      vi.fn().mockResolvedValue({ success: true, data: 2 });
    const result = await dispatchDashboardSqlite(
      { subtype: 'restore_chunk', stagingName: STAGING, offset: 3, data: 'ChQ=', confirmToken: VALID_TOKEN },
      sqliteClient,
      { getConfirmToken: async () => VALID_TOKEN }
    );

    expect(result).toEqual({ success: true, written: 2 });
    expect((sqliteClient as unknown as { maintain: ReturnType<typeof vi.fn> }).maintain)
      .toHaveBeenCalledWith({ type: 'restoreAppend', stagingName: STAGING, offset: 3, dataBase64: 'ChQ=' });
  });

  it('routes restore_abort to the maintain gateway (cleanup path)', async () => {
    const result = await dispatchDashboardSqlite(
      { subtype: 'restore_abort', stagingName: STAGING, confirmToken: VALID_TOKEN },
      sqliteClient,
      { getConfirmToken: async () => VALID_TOKEN }
    );

    expect(result).toEqual({ success: true });
    expect((sqliteClient as unknown as { maintain: ReturnType<typeof vi.fn> }).maintain)
      .toHaveBeenCalledWith({ type: 'restoreAbort', stagingName: STAGING });
  });

  it('forwards the failure reason from a failed restore_commit', async () => {
    (sqliteClient as unknown as { maintain: ReturnType<typeof vi.fn> }).maintain =
      vi.fn().mockResolvedValue({ success: false, error: { kind: 'unknown', message: 'staged size mismatch', retriable: false } });

    const result = await dispatchDashboardSqlite(
      { subtype: 'restore_commit', stagingName: STAGING, totalBytes: 8, confirmToken: VALID_TOKEN },
      sqliteClient,
      { getConfirmToken: async () => VALID_TOKEN }
    );

    expect(result).toEqual({ success: false, error: 'staged size mismatch', retriable: false });
  });
});
