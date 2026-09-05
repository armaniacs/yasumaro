import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../utils/logger.js', () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  ErrorCode: { UNKNOWN_ERROR: 'UNKNOWN_ERROR', INTERNAL_ERROR: 'INTERNAL_ERROR' },
}));

vi.mock('../../../utils/errorUtils.js', () => ({
  errorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

vi.mock('../../../utils/storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

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

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../../utils/storage/defaults.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

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

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../../utils/storage/encryptionSession.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

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

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../../utils/storage/savedUrlRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

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

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../../utils/storage/domainFilterCache.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

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

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../../utils/storage/quota.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

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

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;

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
    query: vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } }),
    search: vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } }),
    toggleStar: vi.fn().mockResolvedValue({ is_starred: 1 }),
    delete: vi.fn().mockResolvedValue(true),
    update: vi.fn().mockResolvedValue(true),
    getCount: vi.fn().mockResolvedValue({ success: true, data: 0 }),
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
    backupDb: vi.fn().mockResolvedValue({ success: true, data: new Uint8Array([1]) }),
    lastError: () => lastError,
    runMigration: vi.fn().mockResolvedValue({ success: true, count: 0, read: 0, inserted: 0 }),
    getConfirmToken: vi.fn().mockResolvedValue('token'),
    runBackfill: vi.fn().mockResolvedValue({ updated: 0, total: 0 }),
    runCleanup: vi.fn().mockResolvedValue({ removed: [], totalBytes: 0 }),
    runLegacyResync: vi.fn().mockResolvedValue({ examined: 0, written: 0, skipped: 0, total: 0 }),
    queryAuditLog: vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } }),
    ...overrides,
  };

  return { deps, setLastError: (value) => { lastError = value; } };
}

/** A read-path failure carrying a categorized reason. */
function failure(message: string, retriable = false) {
  return { success: false, error: { kind: 'quota', message, retriable } };
}

describe('dashboard SQLite handler — read-path error propagation', () => {
  /**
   * The regression this guards: the categorized message must reach the
   * dashboard rather than being replaced by a generic fallback.
   *
   * It previously travelled via `deps.lastError()` — shared mutable state on
   * SqliteClient. That worked only because reads happened to follow their own
   * failure closely enough; it described "the most recent failure by anyone".
   * The read path now returns the reason with the call that produced it, so
   * this holds regardless of what else is in flight.
   */
  it('surfaces the categorized message returned by the failing call', async () => {
    const { deps } = makeDeps();
    (deps.query as ReturnType<typeof vi.fn>).mockResolvedValue(failure(QUOTA_MESSAGE));

    const handler = createDashboardSqliteHandler(deps);
    const result = await handler({ subtype: 'query' });

    expect(result).toEqual({ success: false, error: QUOTA_MESSAGE, retriable: false });
  });

  it('does not attribute another operation error to this call', async () => {
    // lastError holds an unrelated failure. Before, the handler would have
    // reported it as this query's reason.
    const { deps, setLastError } = makeDeps();
    setLastError(QUOTA_MESSAGE);
    (deps.query as ReturnType<typeof vi.fn>).mockResolvedValue(failure(TIMEOUT_MESSAGE, true));

    const handler = createDashboardSqliteHandler(deps);
    const result = await handler({ subtype: 'query' });

    expect(result).toEqual({ success: false, error: TIMEOUT_MESSAGE, retriable: true });
  });

  it('marks transient failures retriable so the dashboard can retry', async () => {
    const { deps } = makeDeps();
    (deps.getCount as ReturnType<typeof vi.fn>).mockResolvedValue(failure(TIMEOUT_MESSAGE, true));

    const handler = createDashboardSqliteHandler(deps);
    const result = await handler({ subtype: 'get_count' });

    expect(result).toEqual({ success: false, error: TIMEOUT_MESSAGE, retriable: true });
  });

  it('reflects an error raised after the handler was created', async () => {
    const { deps } = makeDeps();
    const handler = createDashboardSqliteHandler(deps);

    // Handler already exists; a later failure must still be visible.
    (deps.getCount as ReturnType<typeof vi.fn>).mockResolvedValue(failure(TIMEOUT_MESSAGE));

    const result = await handler({ subtype: 'get_count' });
    expect(result).toEqual({ success: false, error: TIMEOUT_MESSAGE, retriable: false });
  });

  /**
   * `getStatus` deliberately stays outside the CallResult migration: it
   * reports initialization failures inside its success value (as
   * `initError`) so the diagnostics panel can display them — see
   * SqliteClient.getStatus(). A real SqliteClient never resolves it to
   * `null`; this only exercises the handler's defensive fallback for the
   * type's `| null`, and confirms it no longer reads shared state to build
   * the message (PBI-21 removed `lastError` from the deps entirely).
   */
  it('falls back to a fixed message if getStatus ever resolves to null', async () => {
    const { deps } = makeDeps();
    const handler = createDashboardSqliteHandler(deps);

    (deps.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(await handler({ subtype: 'status' })).toEqual({ success: false, error: 'Status check failed' });
  });

  it('propagates the categorized message for search failures', async () => {
    const { deps } = makeDeps();
    (deps.search as ReturnType<typeof vi.fn>).mockResolvedValue(failure(TIMEOUT_MESSAGE, true));

    const handler = createDashboardSqliteHandler(deps);
    const result = await handler({ subtype: 'search', query: 'x' });

    expect(result).toEqual({ success: false, error: TIMEOUT_MESSAGE, retriable: true });
  });
});
