import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatchDashboardSqlite } from '../handlers/__tests__/dashboardSqliteTestHarness.js';
import { createDashboardSqliteHandler } from '../handlers/dashboardSqliteHandlers.js';
import type { DashboardSqliteHandlerDeps } from '../handlers/dashboardSqliteHandlers.js';
import { SqliteClient } from '../sqliteClient.js';

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
    getSettings: async () => ({}),
    formatEntriesToMarkdown: () => null,
    appendToDailyNote: async () => {},
    restoreDb: async () => ({ success: true, data: undefined }),
    getStatus: async () => null,
    runOpfsSpike: async () => ({ success: true, data: {} }),
    purgeOldRecords: async () => ({ success: true, data: { purged: 0 } }),
    purgeContent: async () => ({ success: true, data: { purged: 0 } }),
    backupDb: async () => ({ success: true, data: new Uint8Array() }),
    runMigration: async () => ({ success: false, error: 'n/a', count: 0, read: 0, inserted: 0 }),
    getConfirmToken: async () => '',
    runBackfill: async () => ({ updated: 0, total: 0 }),
    runCleanup: async () => ({ removed: [], totalBytes: 0 }),
    queryAuditLog: async () => ({ success: true, data: { rows: [], total: 0 } }),
    ...overrides,
  };
}

describe('dashboardSqliteHandlers — confirmation token (H2)', () => {
  let sqliteClient: SqliteClient;
  const VALID_TOKEN = 'test-valid-token-12345';
  const INVALID_TOKEN = 'wrong-token';

  beforeEach(() => {
    sqliteClient = {
      queryResult: vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } }),
      searchResult: vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } }),
      clearAllResult: vi.fn().mockResolvedValue({ success: true, data: undefined }),
      runOpfsSpikeResult: vi.fn().mockResolvedValue({ success: true, data: {} }),
      getStatus: vi.fn().mockResolvedValue(null),
      // Core methods delegate to the *Result wrappers so existing test assertions
      // on queryResult/searchResult/clearAllResult/runOpfsSpikeResult keep working.
      query: vi.fn().mockImplementation((op: any) => {
        if (op.kind === 'search') return (sqliteClient as any).searchResult(op.text, op.limit, op.offset, op);
        if (op.kind === 'count') return Promise.resolve({ success: true, data: 0 });
        return (sqliteClient as any).queryResult(op);
      }),
      mutate: vi.fn().mockImplementation((op: any) => {
        if (op.type === 'clearAll') return (sqliteClient as any).clearAllResult();
        return Promise.resolve({ success: true, data: undefined });
      }),
      maintain: vi.fn().mockImplementation((op: any) => {
        if (op.type === 'clearAll') return (sqliteClient as any).clearAllResult();
        if (op.type === 'opfsSpike') return (sqliteClient as any).runOpfsSpikeResult();
        if (op.type === 'restore') return (sqliteClient as any).restoreDbResult(op.data);
        if (op.type === 'backup') return (sqliteClient as any).backupDbResult();
        if (op.type === 'purgeOldRecords') return (sqliteClient as any).purgeOldRecordsResult(op.retentionDays, op.maxRecords);
        if (op.type === 'purgeContent') return (sqliteClient as any).purgeContentResult(op.retentionDays, op.maxRecords, op.includeStarred);
        return Promise.resolve({ success: true, data: undefined });
      }),
    } as any;
  });

  it('rejects clear_all without confirmToken', async () => {
    const result = await dispatchDashboardSqlite(
      { subtype: 'clear_all' },
      sqliteClient,
      { getConfirmToken: async () => VALID_TOKEN }
    );
    expect(result).toEqual({ success: false, error: expect.stringContaining('token') });
    expect((sqliteClient as unknown as { clearAllResult: ReturnType<typeof vi.fn> }).clearAllResult).not.toHaveBeenCalled();
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
    expect((sqliteClient as unknown as { clearAllResult: ReturnType<typeof vi.fn> }).clearAllResult).toHaveBeenCalled();
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

  it('routes opfs_spike to sqliteClient.runOpfsSpikeResult and returns the report', async () => {
    const report = { strategy: 'opfs-async-main', steps: [], passed: true, durationMs: 5 };
    // Stub runOpfsSpikeResult, not runOpfsSpike — see the clearAllResult
    // comment above.
    (sqliteClient as unknown as { runOpfsSpikeResult: ReturnType<typeof vi.fn> }).runOpfsSpikeResult =
      vi.fn().mockResolvedValue({ success: true, data: report });

    const result = await dispatchDashboardSqlite({ subtype: 'opfs_spike' }, sqliteClient);

    expect((sqliteClient as unknown as { runOpfsSpikeResult: ReturnType<typeof vi.fn> }).runOpfsSpikeResult).toHaveBeenCalled();
    expect(result).toEqual({ success: true, report });
  });

  it('returns an error when opfs_spike yields no report', async () => {
    (sqliteClient as unknown as { runOpfsSpikeResult: ReturnType<typeof vi.fn> }).runOpfsSpikeResult =
      vi.fn().mockResolvedValue({ success: false, error: { kind: 'unknown', message: 'OPFS spike failed', retriable: false } });

    const result = await dispatchDashboardSqlite({ subtype: 'opfs_spike' }, sqliteClient);

    expect(result).toEqual({ success: false, error: expect.stringContaining('spike'), retriable: false });
  });

  it('allows query without confirmToken (read-only)', async () => {
    // Stub queryResult, not query: the read path calls the Result variant so
    // each failure's reason stays attached to the call that produced it.
    (sqliteClient as unknown as { queryResult: ReturnType<typeof vi.fn> }).queryResult =
      vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } });
    const result = await dispatchDashboardSqlite(
      { subtype: 'query' },
      sqliteClient,
      { getConfirmToken: async () => VALID_TOKEN }
    );
    expect(result).toMatchObject({ success: true });
  });

  it('wraps search results with success:true (regression: dashboard search showed load error)', async () => {
    // searchResult resolves to a CallResult carrying { rows, total }. The
    // handler must unwrap it and add success:true so the dashboard service does
    // not treat a valid result as a failure ("データの読み込みに失敗しました").
    const rows = [{ id: 1, url: 'https://a.com', title: 'kddi', rank: -1 }];
    (sqliteClient as unknown as { searchResult: ReturnType<typeof vi.fn> }).searchResult =
      vi.fn().mockResolvedValue({ success: true, data: { rows, total: 1 } });
    const result = await dispatchDashboardSqlite(
      { subtype: 'search', query: 'kddi' },
      sqliteClient,
      { getConfirmToken: async () => VALID_TOKEN }
    );
    expect(result).toEqual({ success: true, rows, total: 1 });
  });

  it('returns success:false when search yields an error', async () => {
    (sqliteClient as unknown as { searchResult: ReturnType<typeof vi.fn> }).searchResult =
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

describe('restore_db subtype', () => {
  let sqliteClient: Record<string, unknown>;
  const VALID_TOKEN = 'test-valid-token-12345';

  beforeEach(() => {
    sqliteClient = {
      restoreDbResult: vi.fn().mockResolvedValue({ success: true, data: undefined }),
      maintain: vi.fn().mockImplementation((op: any) => {
        if (op.type === 'restore') return (sqliteClient as any).restoreDbResult(op.data);
        return Promise.resolve({ success: true, data: undefined });
      }),
      query: vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } }),
      mutate: vi.fn().mockResolvedValue({ success: true, data: undefined }),
      getStatus: vi.fn().mockResolvedValue(null),
    };
  });

  it('rejects without a valid confirmToken', async () => {
    const result = await dispatchDashboardSqlite(
      { subtype: 'restore_db', data: 'AQID' },
      sqliteClient,
      { getConfirmToken: async () => VALID_TOKEN }
    );

    expect(result).toEqual({ success: false, error: expect.stringContaining('token') });
    expect((sqliteClient as unknown as { restoreDbResult: ReturnType<typeof vi.fn> }).restoreDbResult).not.toHaveBeenCalled();
  });

  it('calls sqliteClient.restoreDbResult with the provided bytes when token matches', async () => {
    const result = await dispatchDashboardSqlite(
      { subtype: 'restore_db', data: 'AQID', confirmToken: VALID_TOKEN },
      sqliteClient,
      { getConfirmToken: async () => VALID_TOKEN }
    );

    expect(result).toEqual({ success: true });
    expect((sqliteClient as unknown as { restoreDbResult: ReturnType<typeof vi.fn> }).restoreDbResult).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
  });

  it('returns failure when restoreDb resolves false', async () => {
    (sqliteClient as unknown as { restoreDbResult: ReturnType<typeof vi.fn> }).restoreDbResult =
      vi.fn().mockResolvedValue({ success: false, error: { kind: 'unknown', message: 'Restore failed', retriable: false } });

    const result = await dispatchDashboardSqlite(
      { subtype: 'restore_db', data: 'AQID', confirmToken: VALID_TOKEN },
      sqliteClient,
      { getConfirmToken: async () => VALID_TOKEN }
    );

    expect(result).toEqual({ success: false, error: 'Restore failed', retriable: false });
  });
});
