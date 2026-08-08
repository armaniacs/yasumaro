import { describe, it, expect, vi } from 'vitest';

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

import { createDashboardSqliteHandler } from '../dashboardSqliteHandlers.js';
import type { DashboardSqliteHandlerDeps } from '../dashboardSqliteHandlers.js';

/**
 * The categorized messages SqliteClient.categorizeError() produces. These are
 * the strings that were never reaching the dashboard.
 */
const QUOTA_MESSAGE = 'Storage quota exceeded. Some older records may have been removed.';
const TIMEOUT_MESSAGE = 'SQLite request timed out. The database may still be initializing.';

/**
 * Builds deps whose lastError getter reads a mutable cell, mirroring how
 * production reads a field that SqliteClient mutates as calls fail.
 */
function makeDeps(overrides: Partial<DashboardSqliteHandlerDeps> = {}): {
  deps: DashboardSqliteHandlerDeps;
  setLastError: (value: string | null) => void;
} {
  let lastError: string | null = null;

  const deps: DashboardSqliteHandlerDeps = {
    query: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    search: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    toggleStar: vi.fn().mockResolvedValue({ is_starred: 1 }),
    delete: vi.fn().mockResolvedValue(true),
    update: vi.fn().mockResolvedValue(true),
    getCount: vi.fn().mockResolvedValue(0),
    clearAll: vi.fn().mockResolvedValue(true),
    insert: vi.fn().mockResolvedValue({ id: 1 }),
    getSettings: vi.fn().mockResolvedValue({}),
    formatEntriesToMarkdown: vi.fn().mockReturnValue(''),
    appendToDailyNote: vi.fn().mockResolvedValue(undefined),
    restoreDb: vi.fn().mockResolvedValue(true),
    getStatus: vi.fn().mockResolvedValue({ initialized: true }),
    runOpfsSpike: vi.fn().mockResolvedValue({}),
    purgeOldRecords: vi.fn().mockResolvedValue({ purged: 0 }),
    purgeContent: vi.fn().mockResolvedValue({ purged: 0 }),
    backupDb: vi.fn().mockResolvedValue(new Uint8Array([1])),
    lastError: () => lastError,
    runMigration: vi.fn().mockResolvedValue({ success: true, count: 0 }),
    getConfirmToken: vi.fn().mockResolvedValue('token'),
    runBackfill: vi.fn().mockResolvedValue({ updated: 0, total: 0 }),
    runCleanup: vi.fn().mockResolvedValue({ removed: [], totalBytes: 0 }),
    queryAuditLog: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    ...overrides,
  };

  return { deps, setLastError: (value) => { lastError = value; } };
}

describe('dashboard SQLite handler — lastError propagation', () => {
  /**
   * The regression this guards: the error is set by the failing call itself,
   * i.e. AFTER the handler was constructed. A snapshot taken at construction
   * time (the old `lastError: string | null` shape) can never observe it.
   */
  it('surfaces the categorized message set during the failing call', async () => {
    const { deps, setLastError } = makeDeps();
    (deps.query as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      setLastError(QUOTA_MESSAGE);
      return null;
    });

    const handler = createDashboardSqliteHandler(deps);
    const result = await handler({ subtype: 'query' });

    expect(result).toEqual({ success: false, error: QUOTA_MESSAGE });
  });

  it('falls back to the generic message when no categorized error is present', async () => {
    const { deps } = makeDeps();
    (deps.query as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const handler = createDashboardSqliteHandler(deps);
    const result = await handler({ subtype: 'query' });

    expect(result).toEqual({ success: false, error: 'Query failed' });
  });

  it('reflects an error raised after the handler was created', async () => {
    const { deps, setLastError } = makeDeps();
    const handler = createDashboardSqliteHandler(deps);

    // Handler already exists; a later failure must still be visible.
    setLastError(TIMEOUT_MESSAGE);
    (deps.getCount as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await handler({ subtype: 'get_count' });
    expect(result).toEqual({ success: false, error: TIMEOUT_MESSAGE });
  });

  it('reports the newest error across successive failures', async () => {
    const { deps, setLastError } = makeDeps();
    const handler = createDashboardSqliteHandler(deps);

    setLastError(QUOTA_MESSAGE);
    (deps.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(await handler({ subtype: 'status' })).toEqual({ success: false, error: QUOTA_MESSAGE });

    setLastError(TIMEOUT_MESSAGE);
    expect(await handler({ subtype: 'status' })).toEqual({ success: false, error: TIMEOUT_MESSAGE });
  });

  it('propagates the categorized message for search failures', async () => {
    const { deps, setLastError } = makeDeps();
    (deps.search as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      setLastError(TIMEOUT_MESSAGE);
      return null;
    });

    const handler = createDashboardSqliteHandler(deps);
    const result = await handler({ subtype: 'search', query: 'x' });

    expect(result).toEqual({ success: false, error: TIMEOUT_MESSAGE });
  });
});
