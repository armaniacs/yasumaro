/**
 * gistSyncTarget-r2.test.ts
 * Additional coverage for GistSyncTarget: testConnection, syncBatch, error paths
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
const mockGetAll = vi.hoisted(() => vi.fn());
const mockSet = vi.hoisted(() => vi.fn());

import { GistSyncTarget } from '../syncTargets/gistSyncTarget.js';

vi.mock('../sqlite/offscreenGateway.js', () => ({
  SqliteClient: vi.fn().mockImplementation(() => {
    const qr = vi.fn();
    const ur = vi.fn();
    return {
      query: qr,
      mutate: ur,
      maintain: vi.fn(),
    };
  }),
}));

vi.mock('../../utils/storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    StorageKeys: {
      GIST_ENABLED: 'gist_enabled',
      GITHUB_PAT: 'github_pat',
      GIST_ID: 'gist_id',
    },

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
vi.mock('../../utils/storage/defaults.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    StorageKeys: {
      GIST_ENABLED: 'gist_enabled',
      GITHUB_PAT: 'github_pat',
      GIST_ID: 'gist_id',
    },

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
vi.mock('../../utils/storage/encryptionSession.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    StorageKeys: {
      GIST_ENABLED: 'gist_enabled',
      GITHUB_PAT: 'github_pat',
      GIST_ID: 'gist_id',
    },

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
vi.mock('../../utils/storage/savedUrlRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    StorageKeys: {
      GIST_ENABLED: 'gist_enabled',
      GITHUB_PAT: 'github_pat',
      GIST_ID: 'gist_id',
    },

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
vi.mock('../../utils/storage/domainFilterCache.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    StorageKeys: {
      GIST_ENABLED: 'gist_enabled',
      GITHUB_PAT: 'github_pat',
      GIST_ID: 'gist_id',
    },

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
vi.mock('../../utils/storage/quota.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    StorageKeys: {
      GIST_ENABLED: 'gist_enabled',
      GITHUB_PAT: 'github_pat',
      GIST_ID: 'gist_id',
    },

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


vi.mock('../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  // WHY: isConfigured() now reads via getMany(); route it through the same
  // mockGetAll used by the rest of these tests instead of a separate mock,
  // so existing mockGetAll.mockResolvedValue(...) calls stay in effect.
  const getManyFromAll = async (keys: readonly string[]) => {
    const all = await mockGetAll();
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = all?.[k];
    return out;
  };
  return {
    ...actual,
    settingsRepository: {
      getAll: mockGetAll,
      get: vi.fn(),
      set: mockSet,
      setAll: vi.fn(),
      getMany: getManyFromAll,
    },
    SettingsRepository: class {
      getAll = mockGetAll;
      get = vi.fn();
      set = mockSet;
      setAll = vi.fn();
      getMany = getManyFromAll;
    },
  };
});

vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
}));

import { addLog } from '../../utils/logger.js';

describe('GistSyncTarget - extended coverage', () => {
  let target: GistSyncTarget;
  let mockSqliteClient: { query: ReturnType<typeof vi.fn>; mutate: ReturnType<typeof vi.fn>; maintain: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    const qr = vi.fn();
    const ur = vi.fn();
    mockSqliteClient = {
      query: qr,
      mutate: ur,
      maintain: vi.fn(),
    };
    target = new GistSyncTarget(mockSqliteClient as any);
  });

  describe('isConfigured', () => {
    it('returns false when getSettings throws', async () => {
      mockGetAll.mockRejectedValue(new Error('storage error'));
      const result = await target.isConfigured();
      expect(result).toBe(false);
    });
  });

  describe('testConnection', () => {
    it('returns success when GitHub API responds ok', async () => {
      mockGetAll.mockResolvedValue({ github_pat: 'ghp_valid' } as any);
      global.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);

      const result = await target.testConnection();

      expect(result).toEqual({ success: true, message: 'Connected to GitHub successfully' });
      expect(global.fetch).toHaveBeenCalledWith('https://api.github.com/user', expect.any(Object));
    });

    it('returns unauthorized message on 401', async () => {
      mockGetAll.mockResolvedValue({ github_pat: 'ghp_bad' } as any);
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response);

      const result = await target.testConnection();

      expect(result).toEqual({ success: false, message: 'Invalid GitHub PAT (unauthorized)' });
    });

    it('returns generic error for other status codes', async () => {
      mockGetAll.mockResolvedValue({ github_pat: 'ghp_test' } as any);
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);

      const result = await target.testConnection();

      expect(result).toEqual({ success: false, message: 'GitHub API error: 500' });
    });

    it('returns connection failed message on network error', async () => {
      mockGetAll.mockResolvedValue({ github_pat: 'ghp_test' } as any);
      global.fetch = vi.fn().mockRejectedValue(new Error('Network failure'));

      const result = await target.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Connection failed');
      expect(result.message).toContain('Network failure');
    });

    it('returns not configured when PAT is absent', async () => {
      mockGetAll.mockResolvedValue({} as any);
      const result = await target.testConnection();
      expect(result).toEqual({ success: false, message: 'GitHub PAT not configured' });
    });
  });

  describe('sync', () => {
    it('updates an existing Gist when GIST_ID is set', async () => {
      mockGetAll.mockResolvedValue({ github_pat: 'ghp_test', gist_id: 'existing-123' } as any);
      mockSqliteClient.mutate.mockResolvedValue({ success: true, data: undefined });
      global.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);

      const result = await target.sync(1, 'https://example.com', 'Test', 'Summary');

      expect(result.success).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/gists/existing-123',
        expect.objectContaining({ method: 'PATCH' }),
      );
      expect(mockSqliteClient.mutate).toHaveBeenCalledWith({ type: 'update', id: 1, changes: { gist_synced: 1 } });
      expect(mockSet).not.toHaveBeenCalled();
    });

    it('returns false when createGist fails', async () => {
      mockGetAll.mockResolvedValue({ github_pat: 'ghp_test' } as any);
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 422 } as Response);

      const result = await target.sync(1, 'https://example.com', 'Test', 'Summary');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(mockSqliteClient.mutate).not.toHaveBeenCalled();
      expect(addLog).toHaveBeenCalledWith('WARN', 'GistSync: failed (silent skip)', expect.any(Object));
    });

    it('returns success false when updateGist fails', async () => {
      mockGetAll.mockResolvedValue({ github_pat: 'ghp_test', gist_id: 'existing-123' } as any);
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response);

      const result = await target.sync(1, 'https://example.com', 'Test', 'Summary');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('uses provided markdown argument when given', async () => {
      mockGetAll.mockResolvedValue({ github_pat: 'ghp_test' } as any);
      global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 'gist-1' }) } as Response);
      mockSqliteClient.mutate.mockResolvedValue({ success: true, data: undefined });

      const result = await target.sync(1, 'https://example.com', 'Title', null, '# Custom markdown');

      expect(result.success).toBe(true);
      const callBody = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(callBody.files['yasumaro-history.md'].content).toBe('# Custom markdown');
    });
  });

  describe('syncBatch', () => {
    it('returns 0 when not configured', async () => {
      mockGetAll.mockResolvedValue({} as any);
      const result = await target.syncBatch();
      expect(result).toBe(0);
    });

    it('propagates query failure', async () => {
      mockGetAll.mockResolvedValue({ github_pat: 'ghp_test' } as any);
      mockSqliteClient.query.mockResolvedValue({
        success: false,
        error: { kind: 'sqlite', message: 'query returned null', retriable: false },
      });

      await expect(target.syncBatch()).rejects.toThrow('query returned null');
    });

    it('returns 0 when query returns empty rows', async () => {
      mockGetAll.mockResolvedValue({ github_pat: 'ghp_test' } as any);
      mockSqliteClient.query.mockResolvedValue({ success: true, data: { rows: [], total: 0 } });

      const result = await target.syncBatch();
      expect(result).toBe(0);
    });

    it('returns 0 when no unsynced rows', async () => {
      mockGetAll.mockResolvedValue({ github_pat: 'ghp_test' } as any);
      // DB-level gistSynced filter returns no rows for synced records
      mockSqliteClient.query.mockResolvedValue({ success: true, data: { rows: [], total: 0 } });

      const result = await target.syncBatch();
      expect(result).toBe(0);
    });

    it('syncs unsynced rows and returns count', async () => {
      mockGetAll.mockResolvedValue({ github_pat: 'ghp_test' } as any);
      mockSqliteClient.query
        .mockResolvedValueOnce({
          success: true,
          data: {
            rows: [
              { id: 1, url: 'https://a.com', title: 'A', summary: 'Sum A', gist_synced: 0 },
              { id: 2, url: 'https://b.com', title: 'B', summary: null, gist_synced: 0 },
            ],
            total: 2,
          },
        })
        .mockResolvedValueOnce({ success: true, data: { rows: [], total: 0 } });
      global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 'gist-new' }) } as Response);
      mockSqliteClient.mutate.mockResolvedValue({ success: true, data: undefined });

      const result = await target.syncBatch();

      expect(result).toBe(2);
      expect(mockSqliteClient.mutate).toHaveBeenCalledTimes(2);
    });

    it('propagates query errors', async () => {
      mockGetAll.mockResolvedValue({ github_pat: 'ghp_test' } as any);
      mockSqliteClient.query.mockRejectedValue(new Error('db error'));

      await expect(target.syncBatch()).rejects.toThrow('db error');
      expect(addLog).toHaveBeenCalledWith('WARN', 'GistSync: batch failed', expect.any(Object));
    });

    it('skips rows with undefined id', async () => {
      mockGetAll.mockResolvedValue({ github_pat: 'ghp_test' } as any);
      mockSqliteClient.query
        .mockResolvedValueOnce({
          success: true,
          data: {
            rows: [
              { url: 'https://a.com', title: 'A', obsidian_synced: 0 },
              { id: 2, url: 'https://b.com', title: 'B', obsidian_synced: 0 },
            ],
            total: 2,
          },
        })
        .mockResolvedValueOnce({ success: true, data: { rows: [], total: 0 } });
      global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 'gist-new' }) } as Response);
      mockSqliteClient.mutate.mockResolvedValue({ success: true, data: undefined });

      const result = await target.syncBatch();

      expect(result).toBe(1);
      expect(mockSqliteClient.mutate).toHaveBeenCalledTimes(1);
    });

    it('processes all unsynced records across multiple batches', async () => {
      mockGetAll.mockResolvedValue({ github_pat: 'ghp_test' } as any);
      mockSqliteClient.query
        .mockResolvedValueOnce({
          success: true,
          data: {
            rows: [{ id: 1, url: 'https://a.com', title: 'A', summary: null, gist_synced: 0 }],
            total: 1,
          },
        })
        .mockResolvedValueOnce({
          success: true,
          data: {
            rows: [{ id: 2, url: 'https://b.com', title: 'B', summary: null, gist_synced: 0 }],
            total: 1,
          },
        })
        .mockResolvedValueOnce({ success: true, data: { rows: [], total: 0 } });
      global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 'gist-new' }) } as Response);
      mockSqliteClient.mutate.mockResolvedValue({ success: true, data: undefined });

      const result = await target.syncBatch();

      expect(result).toBe(2);
      expect(mockSqliteClient.query).toHaveBeenCalledTimes(3);
      expect(mockSqliteClient.mutate).toHaveBeenCalledTimes(2);
    });
  });
});
