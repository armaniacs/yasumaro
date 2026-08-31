import { describe, it, expect, vi, beforeEach } from 'vitest';
const mockGetAll = vi.hoisted(() => vi.fn());
const mockSet = vi.hoisted(() => vi.fn());

vi.mock('../../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    settingsRepository: {
      getAll: mockGetAll,
      get: vi.fn(),
      set: mockSet,
      setAll: vi.fn(),
      getMany: vi.fn(),
    },
    SettingsRepository: class {
      getAll = mockGetAll;
      get = vi.fn();
      set = mockSet;
      setAll = vi.fn();
      getMany = vi.fn();
    },
  };
});


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
vi.mock('../../../utils/storage.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

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

import { dispatchDashboardSqlite } from './dashboardSqliteTestHarness.js';
import { getSettings } from '../../../utils/storage.js';
import { logError } from '../../../utils/logger.js';

function createMockSqliteClient() {
  const client = {
    query: vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } }),
    mutate: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    maintain: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    getStatus: vi.fn().mockResolvedValue({ initialized: true, path: '/db.sqlite3', fallback: false, fts5: true }),
  };
  return client as any;
}

const VALID_TOKEN = 'test-token-12345';
const TK = () => ({ confirmToken: VALID_TOKEN });

describe('handleDashboardSqlite — query', () => {
  it('returns rows and total on success', async () => {
    const mock = createMockSqliteClient();
    mock.query.mockResolvedValue({ success: true, data: { rows: [{ id: 1, url: 'https://a.com' }], total: 1 } });
    const result = await dispatchDashboardSqlite({ subtype: 'query' }, mock as any);
    expect(result).toEqual({ success: true, rows: [{ id: 1, url: 'https://a.com' }], total: 1 });
  });

  it('passes query parameters correctly', async () => {
    const mock = createMockSqliteClient();
    mock.query.mockResolvedValue({ success: true, data: { rows: [], total: 0 } });
    await dispatchDashboardSqlite(
      { subtype: 'query', limit: 10, offset: 5, domain: 'example.com', isStarred: true, since: 100, until: 200, orderBy: 'created_at', orderDir: 'ASC', tagFilter: '#test' },
      mock as any
    );
    expect(mock.query).toHaveBeenCalledWith(expect.objectContaining({
      limit: 10, offset: 5, domain: 'example.com', isStarred: true,
      since: 100, until: 200, orderBy: 'created_at', orderDir: 'ASC', tagFilter: '#test',
    }));
  });

  it.each([
    ['negative', -1, 100],
    ['zero', 0, 100],
    ['non-integer', 0.5, 100],
    ['huge', 1e9, 1000],
    ['normal', 50, 50],
  ])('clamps limit=%s at the trust boundary (query)', async (_label, raw, expected) => {
    const mock = createMockSqliteClient();
    await dispatchDashboardSqlite({ subtype: 'query', limit: raw as number }, mock as any);
    expect(mock.query).toHaveBeenCalledWith(expect.objectContaining({ limit: expected }));
  });

  it('clamps a negative search limit to the search default (50)', async () => {
    const mock = createMockSqliteClient();
    await dispatchDashboardSqlite({ subtype: 'search', query: 'x', limit: -1 }, mock as any);
    expect(mock.query).toHaveBeenCalledWith(expect.objectContaining({ kind: 'search', limit: 50 }));
  });

  it('clamps a negative audit_log_query limit to a positive value within cap', async () => {
    const mock = createMockSqliteClient();
    await dispatchDashboardSqlite({ subtype: 'audit_log_query', limit: -1 } as any, mock as any);
    const call = mock.query.mock.calls.find((c: unknown[]) => (c[0] as { kind?: string }).kind === 'auditLog');
    expect(call[0].limit).toBeGreaterThanOrEqual(1);
    expect(call[0].limit).toBeLessThanOrEqual(1000);
  });

  it('returns error when sqliteClient.query fails', async () => {
    const mock = createMockSqliteClient();
    mock.query.mockResolvedValue({ success: false, error: { kind: 'unknown', message: 'Query failed', retriable: false } });
    const result = await dispatchDashboardSqlite({ subtype: 'query' }, mock as any);
    // retriable accompanies read-path failures so the dashboard can decide
    // whether waiting for initialization is worth another attempt.
    expect(result).toEqual({ success: false, error: 'Query failed', retriable: false });
  });
});

describe('handleDashboardSqlite — toggle_star', () => {
  it('toggles star and returns is_starred', async () => {
    const mock = createMockSqliteClient();
    mock.mutate.mockResolvedValue({ success: true, data: { is_starred: 0 } });
    const result = await dispatchDashboardSqlite({ subtype: 'toggle_star', id: 5, ...TK() }, mock as any, { getConfirmToken: async () => VALID_TOKEN });
    // Previously this response omitted `success`, so the dashboard's
    // `if (response.success)` check always took the failure branch even
    // when the star actually toggled — see PBI-21.
    expect(result).toEqual({ success: true, is_starred: 0 });
    expect(mock.mutate).toHaveBeenCalledWith(expect.objectContaining({ type: 'toggleStar', id: 5 }));
  });

  it('returns error when toggleStar mutate fails', async () => {
    const mock = createMockSqliteClient();
    mock.mutate.mockResolvedValue({ success: false, error: { kind: 'unknown', message: 'Toggle star failed', retriable: false } });
    const result = await dispatchDashboardSqlite({ subtype: 'toggle_star', id: 5, ...TK() }, mock as any, { getConfirmToken: async () => VALID_TOKEN });
    expect(result).toEqual({ success: false, error: 'Toggle star failed', retriable: false });
  });
});

describe('handleDashboardSqlite — delete', () => {
  it('deletes entry and returns success', async () => {
    const mock = createMockSqliteClient();
    mock.mutate.mockResolvedValue({ success: true, data: undefined });
    const result = await dispatchDashboardSqlite({ subtype: 'delete', id: 3, ...TK() }, mock as any, { getConfirmToken: async () => VALID_TOKEN });
    expect(result).toEqual({ success: true });
    expect(mock.mutate).toHaveBeenCalledWith(expect.objectContaining({ type: 'delete', id: 3 }));
  });

  it('returns success:false when delete mutate fails', async () => {
    const mock = createMockSqliteClient();
    mock.mutate.mockResolvedValue({ success: false, error: { kind: 'unknown', message: 'Delete failed', retriable: false } });
    const result = await dispatchDashboardSqlite({ subtype: 'delete', id: 3, ...TK() }, mock as any, { getConfirmToken: async () => VALID_TOKEN });
    expect(result).toEqual({ success: false, error: 'Delete failed', retriable: false });
  });
});

describe('handleDashboardSqlite — update', () => {
  it('updates entry fields and returns success', async () => {
    const mock = createMockSqliteClient();
    mock.mutate.mockResolvedValue({ success: true, data: undefined });
    const result = await dispatchDashboardSqlite(
      { subtype: 'update', id: 1, changes: { title: 'New Title' }, ...TK() },
      mock as any,
      { getConfirmToken: async () => VALID_TOKEN }
    );
    expect(result).toEqual({ success: true });
    expect(mock.mutate).toHaveBeenCalledWith(expect.objectContaining({ type: 'update', id: 1, changes: { title: 'New Title' } }));
  });

  it('rejects invalid update fields', async () => {
    const mock = createMockSqliteClient();
    const result = await dispatchDashboardSqlite(
      { subtype: 'update', id: 1, changes: { invalid_field: 'value' }, ...TK() },
      mock as any,
      { getConfirmToken: async () => VALID_TOKEN }
    );
    expect(result).toEqual({ success: false, error: expect.stringContaining('Invalid update fields') });
    expect(mock.mutate).not.toHaveBeenCalled();
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

  it('returns success:false when update mutate fails', async () => {
    const mock = createMockSqliteClient();
    mock.mutate.mockResolvedValue({ success: false, error: { kind: 'unknown', message: 'Update failed', retriable: false } });
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
    mock.query.mockResolvedValue({ success: true, data: 99 });
    const result = await dispatchDashboardSqlite({ subtype: 'get_count' }, mock as any);
    expect(result).toEqual({ success: true, count: 99 });
  });

  it('returns error when getCount query fails', async () => {
    const mock = createMockSqliteClient();
    mock.query.mockResolvedValue({ success: false, error: { kind: 'unknown', message: 'Get count failed', retriable: false } });
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
    expect(mock.mutate).toHaveBeenCalledTimes(3);
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
    expect(mock.mutate).toHaveBeenCalledTimes(120);
  });

  it('increments skipped counter when mutate insert fails', async () => {
    const mock = createMockSqliteClient();
    // mutate insert failure value is a CallResult carrying the reason,
    // matching how the handler treats a failed insert as a skip.
    mock.mutate
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

  it('increments skipped counter when mutate insert throws', async () => {
    const mock = createMockSqliteClient();
    mock.mutate.mockRejectedValueOnce(new Error('DB error'));
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
    mock.maintain.mockResolvedValue({ success: true, data: { purged: 7 } });
    mockGetAll.mockResolvedValue({
      sqlite_retention_days: 30,
      sqlite_max_records: 5000,
    } as any);
    const result = await dispatchDashboardSqlite({ subtype: 'purge_now', ...TK() }, mock as any, { getConfirmToken: async () => VALID_TOKEN });
    expect(result).toEqual({ success: true, purged: 7, skipped: false });
    expect(mock.maintain).toHaveBeenCalledWith(expect.objectContaining({ type: 'purgeOldRecords', retentionDays: 30, maxRecords: 5000 }));
  });

  it('skips when both settings are null', async () => {
    const mock = createMockSqliteClient();
    mockGetAll.mockResolvedValue({} as any);
    const result = await dispatchDashboardSqlite({ subtype: 'purge_now', ...TK() }, mock as any, { getConfirmToken: async () => VALID_TOKEN });
    expect(result).toEqual({ success: true, purged: 0, skipped: true });
    expect(mock.maintain).not.toHaveBeenCalled();
  });

  it('handles failure from purgeOldRecords maintain', async () => {
    const mock = createMockSqliteClient();
    mock.maintain.mockResolvedValue({ success: false, error: { kind: 'unknown', message: 'Purge failed', retriable: false } });
    mockGetAll.mockResolvedValue({ sqlite_retention_days: 30 } as any);
    const result = await dispatchDashboardSqlite({ subtype: 'purge_now', ...TK() }, mock as any, { getConfirmToken: async () => VALID_TOKEN });
    expect(result).toEqual({ success: false, error: 'Purge failed', retriable: false });
  });

  it('purges with only days configured', async () => {
    const mock = createMockSqliteClient();
    mockGetAll.mockResolvedValue({ sqlite_retention_days: 60 } as any);
    await dispatchDashboardSqlite({ subtype: 'purge_now', ...TK() }, mock as any, { getConfirmToken: async () => VALID_TOKEN });
    expect(mock.maintain).toHaveBeenCalledWith(expect.objectContaining({ type: 'purgeOldRecords', retentionDays: 60 }));
  });

  it('purges with only max configured', async () => {
    const mock = createMockSqliteClient();
    mockGetAll.mockResolvedValue({ sqlite_max_records: 10000 } as any);
    await dispatchDashboardSqlite({ subtype: 'purge_now', ...TK() }, mock as any, { getConfirmToken: async () => VALID_TOKEN });
    expect(mock.maintain).toHaveBeenCalledWith(expect.objectContaining({ type: 'purgeOldRecords', maxRecords: 10000 }));
  });
});

describe('handleDashboardSqlite — content_purge_now', () => {
  it('purges content with all settings', async () => {
    const mock = createMockSqliteClient();
    mock.maintain.mockResolvedValue({ success: true, data: { purged: 3 } });
    mockGetAll.mockResolvedValue({
      content_retention_days: 14,
      content_max_records: 1000,
      content_purge_include_starred: true,
    } as any);
    const result = await dispatchDashboardSqlite({ subtype: 'content_purge_now', ...TK() }, mock as any, { getConfirmToken: async () => VALID_TOKEN });
    expect(result).toEqual({ success: true, purged: 3, skipped: false });
    expect(mock.maintain).toHaveBeenCalledWith(expect.objectContaining({ type: 'purgeContent', retentionDays: 14, maxRecords: 1000, includeStarred: true }));
  });

  it('skips when both content settings are null', async () => {
    const mock = createMockSqliteClient();
    mockGetAll.mockResolvedValue({} as any);
    const result = await dispatchDashboardSqlite({ subtype: 'content_purge_now', ...TK() }, mock as any, { getConfirmToken: async () => VALID_TOKEN });
    expect(result).toEqual({ success: true, purged: 0, skipped: true });
    expect(mock.maintain).not.toHaveBeenCalled();
  });

  it('handles failure from purgeContent maintain', async () => {
    const mock = createMockSqliteClient();
    mock.maintain.mockResolvedValue({ success: false, error: { kind: 'unknown', message: 'Content purge failed', retriable: false } });
    mockGetAll.mockResolvedValue({ content_retention_days: 7 } as any);
    const result = await dispatchDashboardSqlite({ subtype: 'content_purge_now', ...TK() }, mock as any, { getConfirmToken: async () => VALID_TOKEN });
    expect(result).toEqual({ success: false, error: 'Content purge failed', retriable: false });
  });
});

describe('handleDashboardSqlite — backup_db', () => {
  it('rejects backup_db without confirmToken', async () => {
    const mock = createMockSqliteClient();
    const result = await dispatchDashboardSqlite({ subtype: 'backup_db' }, mock as any);
    expect(result).toEqual({ success: false, error: expect.stringContaining('token') });
    expect(mock.maintain).not.toHaveBeenCalled();
  });

  it('returns backup data as array with valid token', async () => {
    const mock = createMockSqliteClient();
    const buffer = new Uint8Array([10, 20, 30]);
    mock.maintain.mockResolvedValue({ success: true, data: buffer });
    const result = await dispatchDashboardSqlite({ subtype: 'backup_db', confirmToken: VALID_TOKEN }, mock as any, { getConfirmToken: async () => VALID_TOKEN });
    expect(result).toEqual({ success: true, data: 'ChQe' });
  });

  it('returns error when backup maintain fails', async () => {
    const mock = createMockSqliteClient();
    mock.maintain.mockResolvedValue({ success: false, error: { kind: 'unknown', message: 'Backup failed', retriable: false } });
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
    mock.query.mockRejectedValue(new Error('Unexpected DB crash'));
    const result = await dispatchDashboardSqlite({ subtype: 'query' }, mock as any);
    expect(result).toEqual({ success: false, error: 'An internal error occurred' });
    expect(logError).toHaveBeenCalled();
  });

  it('catches thrown errors from search', async () => {
    const mock = createMockSqliteClient();
    mock.query.mockRejectedValue(new Error('Search engine error'));
    const result = await dispatchDashboardSqlite(
      { subtype: 'search', query: 'test' },
      mock as any,
    );
    expect(result).toEqual({ success: false, error: 'An internal error occurred' });
  });
});
