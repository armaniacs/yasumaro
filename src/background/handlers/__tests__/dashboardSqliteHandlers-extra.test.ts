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
    OBSIDIAN_ENABLED: 'obsidian_enabled',
    SQLITE_RETENTION_DAYS: 'sqlite_retention_days',
    SQLITE_MAX_RECORDS: 'sqlite_max_records',
    CONTENT_RETENTION_DAYS: 'content_retention_days',
    CONTENT_MAX_RECORDS: 'content_max_records',
    CONTENT_PURGE_INCLUDE_STARRED: 'content_purge_include_starred',
  },
  getSettings: vi.fn(),
  DEFAULT_SETTINGS: {} as any,
}));

import { handleDashboardSqlite } from '../dashboardSqliteHandlers.js';
import { getSettings } from '../../../utils/storage.js';
import { logError } from '../../../utils/logger.js';

function createMockSqliteClient() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    search: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    toggleStar: vi.fn().mockResolvedValue({ is_starred: 1 }),
    delete: vi.fn().mockResolvedValue(true),
    update: vi.fn().mockResolvedValue(true),
    insert: vi.fn().mockResolvedValue(true),
    getCount: vi.fn().mockResolvedValue(42),
    clearAll: vi.fn().mockResolvedValue(true),
    getStatus: vi.fn().mockResolvedValue({ initialized: true, path: '/db.sqlite3', fallback: false, fts5: true }),
    runOpfsSpike: vi.fn().mockResolvedValue({ strategy: 'opfs-async-main', steps: [], passed: true, durationMs: 5 }),
    purgeOldRecords: vi.fn().mockResolvedValue({ purged: 10 }),
    purgeContent: vi.fn().mockResolvedValue({ purged: 5 }),
    backupDb: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    restoreDb: vi.fn().mockResolvedValue(true),
  };
}

const VALID_TOKEN = 'test-token-12345';
const TK = () => ({ confirmToken: VALID_TOKEN });

describe('handleDashboardSqlite — query', () => {
  it('returns rows and total on success', async () => {
    const mock = createMockSqliteClient();
    mock.query.mockResolvedValue({ rows: [{ id: 1, url: 'https://a.com' }], total: 1 });
    const result = await handleDashboardSqlite({ subtype: 'query' }, mock as any);
    expect(result).toEqual({ success: true, rows: [{ id: 1, url: 'https://a.com' }], total: 1 });
  });

  it('passes query parameters correctly', async () => {
    const mock = createMockSqliteClient();
    mock.query.mockResolvedValue({ rows: [], total: 0 });
    await handleDashboardSqlite(
      { subtype: 'query', limit: 10, offset: 5, domain: 'example.com', isStarred: true, since: 100, until: 200, orderBy: 'created_at', orderDir: 'ASC', tagFilter: '#test' },
      mock as any
    );
    expect(mock.query).toHaveBeenCalledWith({
      limit: 10, offset: 5, domain: 'example.com', isStarred: true,
      since: 100, until: 200, orderBy: 'created_at', orderDir: 'ASC', tagFilter: '#test',
    });
  });

  it('returns error when sqliteClient.query returns null', async () => {
    const mock = createMockSqliteClient();
    mock.query.mockResolvedValue(null);
    const result = await handleDashboardSqlite({ subtype: 'query' }, mock as any);
    expect(result).toEqual({ success: false, error: 'Query failed' });
  });
});

describe('handleDashboardSqlite — toggle_star', () => {
  it('toggles star and returns is_starred', async () => {
    const mock = createMockSqliteClient();
    mock.toggleStar.mockResolvedValue({ is_starred: 0 });
    const result = await handleDashboardSqlite({ subtype: 'toggle_star', id: 5, ...TK() }, mock as any, undefined, VALID_TOKEN);
    expect(result).toEqual({ is_starred: 0 });
    expect(mock.toggleStar).toHaveBeenCalledWith(5);
  });

  it('returns error when toggleStar returns null/undefined', async () => {
    const mock = createMockSqliteClient();
    mock.toggleStar.mockResolvedValue(null);
    const result = await handleDashboardSqlite({ subtype: 'toggle_star', id: 5, ...TK() }, mock as any, undefined, VALID_TOKEN);
    expect(result).toEqual({ success: false, error: 'Toggle star failed' });
  });
});

describe('handleDashboardSqlite — delete', () => {
  it('deletes entry and returns success', async () => {
    const mock = createMockSqliteClient();
    mock.delete.mockResolvedValue(true);
    const result = await handleDashboardSqlite({ subtype: 'delete', id: 3, ...TK() }, mock as any, undefined, VALID_TOKEN);
    expect(result).toEqual({ success: true });
    expect(mock.delete).toHaveBeenCalledWith(3);
  });

  it('returns success:false when delete returns false', async () => {
    const mock = createMockSqliteClient();
    mock.delete.mockResolvedValue(false);
    const result = await handleDashboardSqlite({ subtype: 'delete', id: 3, ...TK() }, mock as any, undefined, VALID_TOKEN);
    expect(result).toEqual({ success: false, error: 'Delete failed' });
  });
});

describe('handleDashboardSqlite — update', () => {
  it('updates entry fields and returns success', async () => {
    const mock = createMockSqliteClient();
    mock.update.mockResolvedValue(true);
    const result = await handleDashboardSqlite(
      { subtype: 'update', id: 1, changes: { title: 'New Title' }, ...TK() },
      mock as any,
      undefined,
      VALID_TOKEN
    );
    expect(result).toEqual({ success: true });
    expect(mock.update).toHaveBeenCalledWith(1, { title: 'New Title' });
  });

  it('rejects invalid update fields', async () => {
    const mock = createMockSqliteClient();
    const result = await handleDashboardSqlite(
      { subtype: 'update', id: 1, changes: { invalid_field: 'value' }, ...TK() },
      mock as any,
      undefined,
      VALID_TOKEN
    );
    expect(result).toEqual({ success: false, error: expect.stringContaining('Invalid update fields') });
    expect(mock.update).not.toHaveBeenCalled();
  });

  it('rejects update with multiple invalid fields', async () => {
    const mock = createMockSqliteClient();
    const result = await handleDashboardSqlite(
      { subtype: 'update', id: 1, changes: { foo: 'a', bar: 'b' }, ...TK() },
      mock as any,
      undefined,
      VALID_TOKEN
    );
    expect(result).toEqual({ success: false, error: expect.stringContaining('foo') });
    expect(result).toEqual({ success: false, error: expect.stringContaining('bar') });
  });

  it('returns success:false when update resolves false', async () => {
    const mock = createMockSqliteClient();
    mock.update.mockResolvedValue(false);
    const result = await handleDashboardSqlite(
      { subtype: 'update', id: 1, changes: { title: 'Test' }, ...TK() },
      mock as any,
      undefined,
      VALID_TOKEN
    );
    expect(result).toEqual({ success: false, error: 'Update failed' });
  });
});

describe('handleDashboardSqlite — get_count', () => {
  it('returns count', async () => {
    const mock = createMockSqliteClient();
    mock.getCount.mockResolvedValue(99);
    const result = await handleDashboardSqlite({ subtype: 'get_count' }, mock as any);
    expect(result).toEqual({ success: true, count: 99 });
  });

  it('returns 0 when getCount returns null', async () => {
    const mock = createMockSqliteClient();
    mock.getCount.mockResolvedValue(null);
    const result = await handleDashboardSqlite({ subtype: 'get_count' }, mock as any);
    expect(result).toEqual({ success: true, count: 0 });
  });
});

describe('handleDashboardSqlite — import', () => {
  it('imports rows in batches and returns inserted/skipped counts', async () => {
    const mock = createMockSqliteClient();
    const rows = Array.from({ length: 3 }, (_, i) => ({
      url: `https://page${i}.com`,
      title: `Page ${i}`,
      created_at: Date.now(),
    }));
    const result = await handleDashboardSqlite(
      { subtype: 'import', rows, ...TK() },
      mock as any,
      undefined,
      VALID_TOKEN
    );
    expect(result).toEqual({ success: true, inserted: 3, skipped: 0, total: 3 });
    expect(mock.insert).toHaveBeenCalledTimes(3);
  });

  it('returns error when rows is empty array', async () => {
    const mock = createMockSqliteClient();
    const result = await handleDashboardSqlite(
      { subtype: 'import', rows: [], ...TK() },
      mock as any,
      undefined,
      VALID_TOKEN
    );
    expect(result).toEqual({ success: false, error: 'No rows provided' });
  });

  it('returns error when rows is not an array', async () => {
    const mock = createMockSqliteClient();
    // Intentionally malformed payload — verifies the runtime Array.isArray
    // guard, which is reachable in practice via the chrome.runtime.onMessage
    // wire (see the cast in service-worker.ts).
    const result = await handleDashboardSqlite(
      { subtype: 'import', rows: 'not-an-array', ...TK() } as any,
      mock as any,
      undefined,
      VALID_TOKEN
    );
    expect(result).toEqual({ success: false, error: 'No rows provided' });
  });

  it('handles batch size correctly for many rows', async () => {
    const mock = createMockSqliteClient();
    const rows = Array.from({ length: 120 }, (_, i) => ({
      url: `https://page${i}.com`,
      created_at: Date.now(),
    }));
    const result = await handleDashboardSqlite(
      { subtype: 'import', rows, ...TK() },
      mock as any,
      undefined,
      VALID_TOKEN
    );
    expect(result).toEqual({ success: true, inserted: 120, skipped: 0, total: 120 });
    expect(mock.insert).toHaveBeenCalledTimes(120);
  });

  it('increments skipped counter when insert fails', async () => {
    const mock = createMockSqliteClient();
    mock.insert.mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true);
    const rows = [
      { url: 'https://fail1.com', created_at: Date.now() },
      { url: 'https://fail2.com', created_at: Date.now() },
      { url: 'https://ok.com', created_at: Date.now() },
    ];
    const result = await handleDashboardSqlite(
      { subtype: 'import', rows, ...TK() },
      mock as any,
      undefined,
      VALID_TOKEN
    );
    expect(result).toEqual({ success: true, inserted: 1, skipped: 2, total: 3 });
  });

  it('increments skipped counter when insert throws', async () => {
    const mock = createMockSqliteClient();
    mock.insert.mockRejectedValueOnce(new Error('DB error'));
    const rows = [{ url: 'https://a.com', created_at: Date.now() }];
    const result = await handleDashboardSqlite(
      { subtype: 'import', rows, ...TK() },
      mock as any,
      undefined,
      VALID_TOKEN
    );
    expect(result).toEqual({ success: true, inserted: 0, skipped: 1, total: 1 });
  });
});

describe('handleDashboardSqlite — purge_now', () => {
  it('purges with both days and max configured', async () => {
    const mock = createMockSqliteClient();
    mock.purgeOldRecords.mockResolvedValue({ purged: 7 });
    vi.mocked(getSettings).mockResolvedValue({
      sqlite_retention_days: 30,
      sqlite_max_records: 5000,
    } as any);
    const result = await handleDashboardSqlite({ subtype: 'purge_now' }, mock as any);
    expect(result).toEqual({ success: true, purged: 7, skipped: false });
    expect(mock.purgeOldRecords).toHaveBeenCalledWith(30, 5000);
  });

  it('skips when both settings are null', async () => {
    const mock = createMockSqliteClient();
    vi.mocked(getSettings).mockResolvedValue({} as any);
    const result = await handleDashboardSqlite({ subtype: 'purge_now' }, mock as any);
    expect(result).toEqual({ success: true, purged: 0, skipped: true });
    expect(mock.purgeOldRecords).not.toHaveBeenCalled();
  });

  it('handles null result from purgeOldRecords', async () => {
    const mock = createMockSqliteClient();
    mock.purgeOldRecords.mockResolvedValue(null);
    vi.mocked(getSettings).mockResolvedValue({ sqlite_retention_days: 30 } as any);
    const result = await handleDashboardSqlite({ subtype: 'purge_now' }, mock as any);
    expect(result).toEqual({ success: false, error: 'Purge failed' });
  });

  it('purges with only days configured', async () => {
    const mock = createMockSqliteClient();
    vi.mocked(getSettings).mockResolvedValue({ sqlite_retention_days: 60 } as any);
    await handleDashboardSqlite({ subtype: 'purge_now' }, mock as any);
    expect(mock.purgeOldRecords).toHaveBeenCalledWith(60, undefined);
  });

  it('purges with only max configured', async () => {
    const mock = createMockSqliteClient();
    vi.mocked(getSettings).mockResolvedValue({ sqlite_max_records: 10000 } as any);
    await handleDashboardSqlite({ subtype: 'purge_now' }, mock as any);
    expect(mock.purgeOldRecords).toHaveBeenCalledWith(undefined, 10000);
  });
});

describe('handleDashboardSqlite — content_purge_now', () => {
  it('purges content with all settings', async () => {
    const mock = createMockSqliteClient();
    mock.purgeContent.mockResolvedValue({ purged: 3 });
    vi.mocked(getSettings).mockResolvedValue({
      content_retention_days: 14,
      content_max_records: 1000,
      content_purge_include_starred: true,
    } as any);
    const result = await handleDashboardSqlite({ subtype: 'content_purge_now' }, mock as any);
    expect(result).toEqual({ success: true, purged: 3, skipped: false });
    expect(mock.purgeContent).toHaveBeenCalledWith(14, 1000, true);
  });

  it('skips when both content settings are null', async () => {
    const mock = createMockSqliteClient();
    vi.mocked(getSettings).mockResolvedValue({} as any);
    const result = await handleDashboardSqlite({ subtype: 'content_purge_now' }, mock as any);
    expect(result).toEqual({ success: true, purged: 0, skipped: true });
    expect(mock.purgeContent).not.toHaveBeenCalled();
  });

  it('handles null result from purgeContent', async () => {
    const mock = createMockSqliteClient();
    mock.purgeContent.mockResolvedValue(null);
    vi.mocked(getSettings).mockResolvedValue({ content_retention_days: 7 } as any);
    const result = await handleDashboardSqlite({ subtype: 'content_purge_now' }, mock as any);
    expect(result).toEqual({ success: false, error: 'Content purge failed' });
  });
});

describe('handleDashboardSqlite — backup_db', () => {
  it('rejects backup_db without confirmToken', async () => {
    const mock = createMockSqliteClient();
    const result = await handleDashboardSqlite({ subtype: 'backup_db' }, mock as any);
    expect(result).toEqual({ success: false, error: expect.stringContaining('token') });
    expect(mock.backupDb).not.toHaveBeenCalled();
  });

  it('returns backup data as array with valid token', async () => {
    const mock = createMockSqliteClient();
    const buffer = new Uint8Array([10, 20, 30]);
    mock.backupDb.mockResolvedValue(buffer);
    const result = await handleDashboardSqlite({ subtype: 'backup_db', confirmToken: VALID_TOKEN }, mock as any, undefined, VALID_TOKEN);
    expect(result).toEqual({ success: true, data: 'ChQe' });
  });

  it('returns error when backupDb returns null', async () => {
    const mock = createMockSqliteClient();
    mock.backupDb.mockResolvedValue(null);
    const result = await handleDashboardSqlite({ subtype: 'backup_db', confirmToken: VALID_TOKEN }, mock as any, undefined, VALID_TOKEN);
    expect(result).toEqual({ success: false, error: 'Backup failed' });
  });
});

describe('handleDashboardSqlite — backfill_metadata', () => {
  it('calls runBackfill and returns result', async () => {
    const mock = createMockSqliteClient();
    const runBackfill = vi.fn().mockResolvedValue({ updated: 5, total: 10 });
    const result = await handleDashboardSqlite(
      { subtype: 'backfill_metadata', ...TK() }, mock as any, undefined, VALID_TOKEN, runBackfill
    );
    expect(result).toEqual({ success: true, updated: 5, total: 10 });
    expect(runBackfill).toHaveBeenCalled();
  });

  it('returns error when runBackfill is not provided', async () => {
    const mock = createMockSqliteClient();
    const result = await handleDashboardSqlite(
      { subtype: 'backfill_metadata', ...TK() }, mock as any, undefined, VALID_TOKEN
    );
    expect(result).toEqual({ success: false, error: 'Backfill not available' });
  });
});

describe('handleDashboardSqlite — cleanup_legacy', () => {
  it('calls runCleanup and returns result', async () => {
    const mock = createMockSqliteClient();
    const runCleanup = vi.fn().mockResolvedValue({ removed: ['key1', 'key2'], totalBytes: 512 });
    const result = await handleDashboardSqlite(
      { subtype: 'cleanup_legacy', ...TK() }, mock as any, undefined, VALID_TOKEN, undefined, runCleanup
    );
    expect(result).toEqual({ success: true, removed: ['key1', 'key2'], totalBytes: 512 });
    expect(runCleanup).toHaveBeenCalled();
  });

  it('returns error when runCleanup is not provided', async () => {
    const mock = createMockSqliteClient();
    const result = await handleDashboardSqlite(
      { subtype: 'cleanup_legacy', ...TK() }, mock as any, undefined, VALID_TOKEN
    );
    expect(result).toEqual({ success: false, error: 'Cleanup not available' });
  });
});

describe('handleDashboardSqlite — status', () => {
  it('returns status fields on success', async () => {
    const mock = createMockSqliteClient();
    mock.getStatus.mockResolvedValue({ initialized: true, path: '/test.db', fallback: false, fts5: true });
    const result = await handleDashboardSqlite({ subtype: 'status' }, mock as any);
    expect(result).toEqual({ success: true, initialized: true, path: '/test.db', fallback: false, fts5: true });
  });

  it('returns error when getStatus returns null', async () => {
    const mock = createMockSqliteClient();
    mock.getStatus.mockResolvedValue(null);
    const result = await handleDashboardSqlite({ subtype: 'status' }, mock as any);
    expect(result).toEqual({ success: false, error: 'Status check failed' });
  });
});

describe('handleDashboardSqlite — migrate', () => {
  it('calls runMigration and returns success result', async () => {
    const mock = createMockSqliteClient();
    const runMigration = vi.fn().mockResolvedValue({ success: true, count: 20, read: 25, inserted: 20 });
    const result = await handleDashboardSqlite(
      { subtype: 'migrate', ...TK() }, mock as any, runMigration, VALID_TOKEN
    );
    expect(result).toEqual({ success: true, count: 20, read: 25, inserted: 20 });
  });

  it('returns error when migration fails', async () => {
    const mock = createMockSqliteClient();
    const runMigration = vi.fn().mockResolvedValue({ success: false, count: 0, error: 'DB locked' });
    const result = await handleDashboardSqlite(
      { subtype: 'migrate', ...TK() }, mock as any, runMigration, VALID_TOKEN
    );
    expect(result).toEqual({ success: false, error: 'DB locked' });
  });

  it('returns error when runMigration is not provided', async () => {
    const mock = createMockSqliteClient();
    const result = await handleDashboardSqlite(
      { subtype: 'migrate', ...TK() },
      mock as any,
      undefined,
      VALID_TOKEN
    );
    expect(result).toEqual({ success: false, error: 'Migration not available' });
  });
});

describe('handleDashboardSqlite — unknown subtype', () => {
  it('returns error for unknown subtype', async () => {
    const mock = createMockSqliteClient();
    // Intentionally an invalid subtype not in DashboardSqliteRequest — verifies the
    // runtime default branch, which is reachable in practice via the
    // chrome.runtime.onMessage wire (see the cast in service-worker.ts).
    const result = await handleDashboardSqlite({ subtype: 'nonexistent' } as any, mock as any);
    expect(result).toEqual({ success: false, error: expect.stringContaining('Unknown subtype') });
  });
});

describe('handleDashboardSqlite — catch block', () => {
  it('catches thrown errors and returns structured error', async () => {
    const mock = createMockSqliteClient();
    mock.query.mockRejectedValue(new Error('Unexpected DB crash'));
    const result = await handleDashboardSqlite({ subtype: 'query' }, mock as any);
    expect(result).toEqual({ success: false, error: 'An internal error occurred' });
    expect(logError).toHaveBeenCalled();
  });

  it('catches thrown errors from search', async () => {
    const mock = createMockSqliteClient();
    mock.search.mockRejectedValue(new Error('Search engine error'));
    const result = await handleDashboardSqlite(
      { subtype: 'search', query: 'test' },
      mock as any,
    );
    expect(result).toEqual({ success: false, error: 'An internal error occurred' });
  });
});
