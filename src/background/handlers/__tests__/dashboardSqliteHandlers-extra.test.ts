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
  API_KEY_FIELDS: [
    'obsidian_api_key',
    'gemini_api_key',
    'openai_api_key',
    'openai_2_api_key',
    'provider_api_key',
    'github_pat',
  ],
}));

import { dispatchDashboardSqlite } from './dashboardSqliteTestHarness.js';
import { getSettings } from '../../../utils/storage.js';
import { logError } from '../../../utils/logger.js';

function createMockSqliteClient() {
  return {
    queryResult: vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } }),
    searchResult: vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } }),
    toggleStarResult: vi.fn().mockResolvedValue({ success: true, data: { is_starred: 1 } }),
    deleteResult: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    updateResult: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    insertResult: vi.fn().mockResolvedValue({ success: true, data: { id: 1 } }),
    getCountResult: vi.fn().mockResolvedValue({ success: true, data: 42 }),
    clearAllResult: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    getStatus: vi.fn().mockResolvedValue({ initialized: true, path: '/db.sqlite3', fallback: false, fts5: true }),
    runOpfsSpikeResult: vi.fn().mockResolvedValue({ success: true, data: { strategy: 'opfs-async-main', steps: [], passed: true, durationMs: 5 } }),
    purgeOldRecordsResult: vi.fn().mockResolvedValue({ success: true, data: { purged: 10 } }),
    purgeContentResult: vi.fn().mockResolvedValue({ success: true, data: { purged: 5 } }),
    backupDbResult: vi.fn().mockResolvedValue({ success: true, data: new Uint8Array([1, 2, 3]) }),
    restoreDbResult: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    queryAuditLogResult: vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } }),
  };
}

const VALID_TOKEN = 'test-token-12345';
const TK = () => ({ confirmToken: VALID_TOKEN });

describe('handleDashboardSqlite — query', () => {
  it('returns rows and total on success', async () => {
    const mock = createMockSqliteClient();
    mock.queryResult.mockResolvedValue({ success: true, data: { rows: [{ id: 1, url: 'https://a.com' }], total: 1 } });
    const result = await dispatchDashboardSqlite({ subtype: 'query' }, mock as any);
    expect(result).toEqual({ success: true, rows: [{ id: 1, url: 'https://a.com' }], total: 1 });
  });

  it('passes query parameters correctly', async () => {
    const mock = createMockSqliteClient();
    mock.queryResult.mockResolvedValue({ success: true, data: { rows: [], total: 0 } });
    await dispatchDashboardSqlite(
      { subtype: 'query', limit: 10, offset: 5, domain: 'example.com', isStarred: true, since: 100, until: 200, orderBy: 'created_at', orderDir: 'ASC', tagFilter: '#test' },
      mock as any
    );
    expect(mock.queryResult).toHaveBeenCalledWith({
      limit: 10, offset: 5, domain: 'example.com', isStarred: true,
      since: 100, until: 200, orderBy: 'created_at', orderDir: 'ASC', tagFilter: '#test',
    });
  });

  it('returns error when sqliteClient.queryResult fails', async () => {
    const mock = createMockSqliteClient();
    mock.queryResult.mockResolvedValue({ success: false, error: { kind: 'unknown', message: 'Query failed', retriable: false } });
    const result = await dispatchDashboardSqlite({ subtype: 'query' }, mock as any);
    // retriable accompanies read-path failures so the dashboard can decide
    // whether waiting for initialization is worth another attempt.
    expect(result).toEqual({ success: false, error: 'Query failed', retriable: false });
  });
});

describe('handleDashboardSqlite — toggle_star', () => {
  it('toggles star and returns is_starred', async () => {
    const mock = createMockSqliteClient();
    mock.toggleStarResult.mockResolvedValue({ success: true, data: { is_starred: 0 } });
    const result = await dispatchDashboardSqlite({ subtype: 'toggle_star', id: 5, ...TK() }, mock as any, { getConfirmToken: async () => VALID_TOKEN });
    // Previously this response omitted `success`, so the dashboard's
    // `if (response.success)` check always took the failure branch even
    // when the star actually toggled — see PBI-21.
    expect(result).toEqual({ success: true, is_starred: 0 });
    expect(mock.toggleStarResult).toHaveBeenCalledWith(5);
  });

  it('returns error when toggleStarResult fails', async () => {
    const mock = createMockSqliteClient();
    mock.toggleStarResult.mockResolvedValue({ success: false, error: { kind: 'unknown', message: 'Toggle star failed', retriable: false } });
    const result = await dispatchDashboardSqlite({ subtype: 'toggle_star', id: 5, ...TK() }, mock as any, { getConfirmToken: async () => VALID_TOKEN });
    expect(result).toEqual({ success: false, error: 'Toggle star failed', retriable: false });
  });
});

describe('handleDashboardSqlite — delete', () => {
  it('deletes entry and returns success', async () => {
    const mock = createMockSqliteClient();
    mock.deleteResult.mockResolvedValue({ success: true, data: undefined });
    const result = await dispatchDashboardSqlite({ subtype: 'delete', id: 3, ...TK() }, mock as any, { getConfirmToken: async () => VALID_TOKEN });
    expect(result).toEqual({ success: true });
    expect(mock.deleteResult).toHaveBeenCalledWith(3);
  });

  it('returns success:false when deleteResult fails', async () => {
    const mock = createMockSqliteClient();
    mock.deleteResult.mockResolvedValue({ success: false, error: { kind: 'unknown', message: 'Delete failed', retriable: false } });
    const result = await dispatchDashboardSqlite({ subtype: 'delete', id: 3, ...TK() }, mock as any, { getConfirmToken: async () => VALID_TOKEN });
    expect(result).toEqual({ success: false, error: 'Delete failed', retriable: false });
  });
});

describe('handleDashboardSqlite — update', () => {
  it('updates entry fields and returns success', async () => {
    const mock = createMockSqliteClient();
    mock.updateResult.mockResolvedValue({ success: true, data: undefined });
    const result = await dispatchDashboardSqlite(
      { subtype: 'update', id: 1, changes: { title: 'New Title' }, ...TK() },
      mock as any,
      { getConfirmToken: async () => VALID_TOKEN }
    );
    expect(result).toEqual({ success: true });
    expect(mock.updateResult).toHaveBeenCalledWith(1, { title: 'New Title' });
  });

  it('rejects invalid update fields', async () => {
    const mock = createMockSqliteClient();
    const result = await dispatchDashboardSqlite(
      { subtype: 'update', id: 1, changes: { invalid_field: 'value' }, ...TK() },
      mock as any,
      { getConfirmToken: async () => VALID_TOKEN }
    );
    expect(result).toEqual({ success: false, error: expect.stringContaining('Invalid update fields') });
    expect(mock.updateResult).not.toHaveBeenCalled();
  });

  it('rejects update with multiple invalid fields', async () => {
    const mock = createMockSqliteClient();
    const result = await dispatchDashboardSqlite(
      { subtype: 'update', id: 1, changes: { foo: 'a', bar: 'b' }, ...TK() },
      mock as any,
      { getConfirmToken: async () => VALID_TOKEN }
    );
    expect(result).toEqual({ success: false, error: expect.stringContaining('foo') });
    expect(result).toEqual({ success: false, error: expect.stringContaining('bar') });
  });

  it('returns success:false when updateResult fails', async () => {
    const mock = createMockSqliteClient();
    mock.updateResult.mockResolvedValue({ success: false, error: { kind: 'unknown', message: 'Update failed', retriable: false } });
    const result = await dispatchDashboardSqlite(
      { subtype: 'update', id: 1, changes: { title: 'Test' }, ...TK() },
      mock as any,
      { getConfirmToken: async () => VALID_TOKEN }
    );
    expect(result).toEqual({ success: false, error: 'Update failed', retriable: false });
  });
});

describe('handleDashboardSqlite — get_count', () => {
  it('returns count', async () => {
    const mock = createMockSqliteClient();
    mock.getCountResult.mockResolvedValue({ success: true, data: 99 });
    const result = await dispatchDashboardSqlite({ subtype: 'get_count' }, mock as any);
    expect(result).toEqual({ success: true, count: 99 });
  });

  it('returns error when getCountResult fails', async () => {
    const mock = createMockSqliteClient();
    mock.getCountResult.mockResolvedValue({ success: false, error: { kind: 'unknown', message: 'Get count failed', retriable: false } });
    const result = await dispatchDashboardSqlite({ subtype: 'get_count' }, mock as any);
    expect(result).toEqual({ success: false, error: 'Get count failed', retriable: false });
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
    const result = await dispatchDashboardSqlite(
      { subtype: 'import', rows, ...TK() },
      mock as any,
      { getConfirmToken: async () => VALID_TOKEN }
    );
    expect(result).toEqual({ success: true, inserted: 3, skipped: 0, total: 3 });
    expect(mock.insertResult).toHaveBeenCalledTimes(3);
  });

  it('returns error when rows is empty array', async () => {
    const mock = createMockSqliteClient();
    const result = await dispatchDashboardSqlite(
      { subtype: 'import', rows: [], ...TK() },
      mock as any,
      { getConfirmToken: async () => VALID_TOKEN }
    );
    expect(result).toEqual({ success: false, error: 'No rows provided' });
  });

  it('returns error when rows is not an array', async () => {
    const mock = createMockSqliteClient();
    // Intentionally malformed payload — verifies the runtime Array.isArray
    // guard, which is reachable in practice via the chrome.runtime.onMessage
    // wire (see the cast in service-worker.ts).
    const result = await dispatchDashboardSqlite(
      { subtype: 'import', rows: 'not-an-array', ...TK() } as any,
      mock as any,
      { getConfirmToken: async () => VALID_TOKEN }
    );
    expect(result).toEqual({ success: false, error: 'No rows provided' });
  });

  it('handles batch size correctly for many rows', async () => {
    const mock = createMockSqliteClient();
    const rows = Array.from({ length: 120 }, (_, i) => ({
      url: `https://page${i}.com`,
      created_at: Date.now(),
    }));
    const result = await dispatchDashboardSqlite(
      { subtype: 'import', rows, ...TK() },
      mock as any,
      { getConfirmToken: async () => VALID_TOKEN }
    );
    expect(result).toEqual({ success: true, inserted: 120, skipped: 0, total: 120 });
    expect(mock.insertResult).toHaveBeenCalledTimes(120);
  });

  it('increments skipped counter when insertResult fails', async () => {
    const mock = createMockSqliteClient();
    // insertResult()'s failure value is a CallResult carrying the reason,
    // matching how the handler treats a failed insert as a skip.
    mock.insertResult
      .mockResolvedValueOnce({ success: false, error: { kind: 'unknown', message: 'Insert failed', retriable: false } })
      .mockResolvedValueOnce({ success: false, error: { kind: 'unknown', message: 'Insert failed', retriable: false } })
      .mockResolvedValue({ success: true, data: { id: 1 } });
    const rows = [
      { url: 'https://fail1.com', created_at: Date.now() },
      { url: 'https://fail2.com', created_at: Date.now() },
      { url: 'https://ok.com', created_at: Date.now() },
    ];
    const result = await dispatchDashboardSqlite(
      { subtype: 'import', rows, ...TK() },
      mock as any,
      { getConfirmToken: async () => VALID_TOKEN }
    );
    expect(result).toEqual({ success: true, inserted: 1, skipped: 2, total: 3 });
  });

  it('increments skipped counter when insertResult throws', async () => {
    const mock = createMockSqliteClient();
    mock.insertResult.mockRejectedValueOnce(new Error('DB error'));
    const rows = [{ url: 'https://a.com', created_at: Date.now() }];
    const result = await dispatchDashboardSqlite(
      { subtype: 'import', rows, ...TK() },
      mock as any,
      { getConfirmToken: async () => VALID_TOKEN }
    );
    expect(result).toEqual({ success: true, inserted: 0, skipped: 1, total: 1 });
  });
});

describe('handleDashboardSqlite — purge_now', () => {
  it('purges with both days and max configured', async () => {
    const mock = createMockSqliteClient();
    mock.purgeOldRecordsResult.mockResolvedValue({ success: true, data: { purged: 7 } });
    vi.mocked(getSettings).mockResolvedValue({
      sqlite_retention_days: 30,
      sqlite_max_records: 5000,
    } as any);
    const result = await dispatchDashboardSqlite({ subtype: 'purge_now', ...TK() }, mock as any, { getConfirmToken: async () => VALID_TOKEN });
    expect(result).toEqual({ success: true, purged: 7, skipped: false });
    expect(mock.purgeOldRecordsResult).toHaveBeenCalledWith(30, 5000);
  });

  it('skips when both settings are null', async () => {
    const mock = createMockSqliteClient();
    vi.mocked(getSettings).mockResolvedValue({} as any);
    const result = await dispatchDashboardSqlite({ subtype: 'purge_now', ...TK() }, mock as any, { getConfirmToken: async () => VALID_TOKEN });
    expect(result).toEqual({ success: true, purged: 0, skipped: true });
    expect(mock.purgeOldRecordsResult).not.toHaveBeenCalled();
  });

  it('handles failure from purgeOldRecordsResult', async () => {
    const mock = createMockSqliteClient();
    mock.purgeOldRecordsResult.mockResolvedValue({ success: false, error: { kind: 'unknown', message: 'Purge failed', retriable: false } });
    vi.mocked(getSettings).mockResolvedValue({ sqlite_retention_days: 30 } as any);
    const result = await dispatchDashboardSqlite({ subtype: 'purge_now', ...TK() }, mock as any, { getConfirmToken: async () => VALID_TOKEN });
    expect(result).toEqual({ success: false, error: 'Purge failed', retriable: false });
  });

  it('purges with only days configured', async () => {
    const mock = createMockSqliteClient();
    vi.mocked(getSettings).mockResolvedValue({ sqlite_retention_days: 60 } as any);
    await dispatchDashboardSqlite({ subtype: 'purge_now', ...TK() }, mock as any, { getConfirmToken: async () => VALID_TOKEN });
    expect(mock.purgeOldRecordsResult).toHaveBeenCalledWith(60, undefined);
  });

  it('purges with only max configured', async () => {
    const mock = createMockSqliteClient();
    vi.mocked(getSettings).mockResolvedValue({ sqlite_max_records: 10000 } as any);
    await dispatchDashboardSqlite({ subtype: 'purge_now', ...TK() }, mock as any, { getConfirmToken: async () => VALID_TOKEN });
    expect(mock.purgeOldRecordsResult).toHaveBeenCalledWith(undefined, 10000);
  });
});

describe('handleDashboardSqlite — content_purge_now', () => {
  it('purges content with all settings', async () => {
    const mock = createMockSqliteClient();
    mock.purgeContentResult.mockResolvedValue({ success: true, data: { purged: 3 } });
    vi.mocked(getSettings).mockResolvedValue({
      content_retention_days: 14,
      content_max_records: 1000,
      content_purge_include_starred: true,
    } as any);
    const result = await dispatchDashboardSqlite({ subtype: 'content_purge_now', ...TK() }, mock as any, { getConfirmToken: async () => VALID_TOKEN });
    expect(result).toEqual({ success: true, purged: 3, skipped: false });
    expect(mock.purgeContentResult).toHaveBeenCalledWith(14, 1000, true);
  });

  it('skips when both content settings are null', async () => {
    const mock = createMockSqliteClient();
    vi.mocked(getSettings).mockResolvedValue({} as any);
    const result = await dispatchDashboardSqlite({ subtype: 'content_purge_now', ...TK() }, mock as any, { getConfirmToken: async () => VALID_TOKEN });
    expect(result).toEqual({ success: true, purged: 0, skipped: true });
    expect(mock.purgeContentResult).not.toHaveBeenCalled();
  });

  it('handles failure from purgeContentResult', async () => {
    const mock = createMockSqliteClient();
    mock.purgeContentResult.mockResolvedValue({ success: false, error: { kind: 'unknown', message: 'Content purge failed', retriable: false } });
    vi.mocked(getSettings).mockResolvedValue({ content_retention_days: 7 } as any);
    const result = await dispatchDashboardSqlite({ subtype: 'content_purge_now', ...TK() }, mock as any, { getConfirmToken: async () => VALID_TOKEN });
    expect(result).toEqual({ success: false, error: 'Content purge failed', retriable: false });
  });
});

describe('handleDashboardSqlite — backup_db', () => {
  it('rejects backup_db without confirmToken', async () => {
    const mock = createMockSqliteClient();
    const result = await dispatchDashboardSqlite({ subtype: 'backup_db' }, mock as any);
    expect(result).toEqual({ success: false, error: expect.stringContaining('token') });
    expect(mock.backupDbResult).not.toHaveBeenCalled();
  });

  it('returns backup data as array with valid token', async () => {
    const mock = createMockSqliteClient();
    const buffer = new Uint8Array([10, 20, 30]);
    mock.backupDbResult.mockResolvedValue({ success: true, data: buffer });
    const result = await dispatchDashboardSqlite({ subtype: 'backup_db', confirmToken: VALID_TOKEN }, mock as any, { getConfirmToken: async () => VALID_TOKEN });
    expect(result).toEqual({ success: true, data: 'ChQe' });
  });

  it('returns error when backupDbResult fails', async () => {
    const mock = createMockSqliteClient();
    mock.backupDbResult.mockResolvedValue({ success: false, error: { kind: 'unknown', message: 'Backup failed', retriable: false } });
    const result = await dispatchDashboardSqlite({ subtype: 'backup_db', confirmToken: VALID_TOKEN }, mock as any, { getConfirmToken: async () => VALID_TOKEN });
    expect(result).toEqual({ success: false, error: 'Backup failed', retriable: false });
  });
});

describe('handleDashboardSqlite — backfill_metadata', () => {
  it('calls runBackfill and returns result', async () => {
    const mock = createMockSqliteClient();
    const runBackfill = vi.fn().mockResolvedValue({ updated: 5, total: 10 });
    const result = await dispatchDashboardSqlite(
      { subtype: 'backfill_metadata', ...TK() }, mock as any, { getConfirmToken: async () => VALID_TOKEN, runBackfill }
    );
    expect(result).toEqual({ success: true, updated: 5, total: 10 });
    expect(runBackfill).toHaveBeenCalled();
  });

  it('returns error when runBackfill is not provided', async () => {
    const mock = createMockSqliteClient();
    const result = await dispatchDashboardSqlite(
      { subtype: 'backfill_metadata', ...TK() }, mock as any, { getConfirmToken: async () => VALID_TOKEN }
    );
    expect(result).toEqual({ success: false, error: 'Backfill not available' });
  });
});

describe('handleDashboardSqlite — cleanup_legacy', () => {
  it('calls runCleanup and returns result', async () => {
    const mock = createMockSqliteClient();
    const runCleanup = vi.fn().mockResolvedValue({ removed: ['key1', 'key2'], totalBytes: 512 });
    const result = await dispatchDashboardSqlite(
      { subtype: 'cleanup_legacy', ...TK() }, mock as any, { getConfirmToken: async () => VALID_TOKEN, runCleanup }
    );
    expect(result).toEqual({ success: true, removed: ['key1', 'key2'], totalBytes: 512 });
    expect(runCleanup).toHaveBeenCalled();
  });

  it('returns error when runCleanup is not provided', async () => {
    const mock = createMockSqliteClient();
    const result = await dispatchDashboardSqlite(
      { subtype: 'cleanup_legacy', ...TK() }, mock as any, { getConfirmToken: async () => VALID_TOKEN }
    );
    expect(result).toEqual({ success: false, error: 'Cleanup not available' });
  });
});

describe('handleDashboardSqlite — status', () => {
  it('returns status fields on success', async () => {
    const mock = createMockSqliteClient();
    mock.getStatus.mockResolvedValue({ initialized: true, path: '/test.db', fallback: false, fts5: true });
    const result = await dispatchDashboardSqlite({ subtype: 'status' }, mock as any);
    expect(result).toEqual({ success: true, initialized: true, path: '/test.db', fallback: false, fts5: true });
  });

  it('returns error when getStatus returns null', async () => {
    const mock = createMockSqliteClient();
    mock.getStatus.mockResolvedValue(null);
    const result = await dispatchDashboardSqlite({ subtype: 'status' }, mock as any);
    expect(result).toEqual({ success: false, error: 'Status check failed' });
  });
});

describe('handleDashboardSqlite — migrate', () => {
  it('calls runMigration and returns success result', async () => {
    const mock = createMockSqliteClient();
    const runMigration = vi.fn().mockResolvedValue({ success: true, count: 20, read: 25, inserted: 20 });
    const result = await dispatchDashboardSqlite(
      { subtype: 'migrate', ...TK() }, mock as any, { runMigration, getConfirmToken: async () => VALID_TOKEN }
    );
    expect(result).toEqual({ success: true, count: 20, read: 25, inserted: 20 });
  });

  it('returns error when migration fails', async () => {
    const mock = createMockSqliteClient();
    const runMigration = vi.fn().mockResolvedValue({ success: false, count: 0, error: 'DB locked' });
    const result = await dispatchDashboardSqlite(
      { subtype: 'migrate', ...TK() }, mock as any, { runMigration, getConfirmToken: async () => VALID_TOKEN }
    );
    expect(result).toEqual({ success: false, error: 'DB locked' });
  });

  it('returns error when runMigration is not provided', async () => {
    const mock = createMockSqliteClient();
    const result = await dispatchDashboardSqlite(
      { subtype: 'migrate', ...TK() },
      mock as any,
      { getConfirmToken: async () => VALID_TOKEN }
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
    const result = await dispatchDashboardSqlite({ subtype: 'nonexistent' } as any, mock as any);
    expect(result).toEqual({ success: false, error: expect.stringContaining('Unknown subtype') });
  });
});

describe('handleDashboardSqlite — catch block', () => {
  it('catches thrown errors and returns structured error', async () => {
    const mock = createMockSqliteClient();
    mock.queryResult.mockRejectedValue(new Error('Unexpected DB crash'));
    const result = await dispatchDashboardSqlite({ subtype: 'query' }, mock as any);
    expect(result).toEqual({ success: false, error: 'An internal error occurred' });
    expect(logError).toHaveBeenCalled();
  });

  it('catches thrown errors from search', async () => {
    const mock = createMockSqliteClient();
    mock.searchResult.mockRejectedValue(new Error('Search engine error'));
    const result = await dispatchDashboardSqlite(
      { subtype: 'search', query: 'test' },
      mock as any,
    );
    expect(result).toEqual({ success: false, error: 'An internal error occurred' });
  });
});
