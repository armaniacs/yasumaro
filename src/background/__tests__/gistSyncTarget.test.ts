/**
 * gistSyncTarget.test.ts
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

vi.mock('../../utils/logger/types.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    addLog: 'fn',
    LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
  }),
);
vi.mock('../../utils/logger/core.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    addLog: 'fn',
    LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
  }),
);
vi.mock('../../utils/logger/api.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    addLog: 'fn',
    LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
  }),
);


describe('GistSyncTarget', () => {
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

  it('isConfigured returns false when no PAT is set', async () => {
    mockGetAll.mockResolvedValue({} as any);
    expect(await target.isConfigured()).toBe(false);
  });

  it('isConfigured returns true when PAT is set', async () => {
    mockGetAll.mockResolvedValue({ github_pat: 'ghp_test123' } as any);
    expect(await target.isConfigured()).toBe(true);
  });

  it('sync returns success false when not configured', async () => {
    mockGetAll.mockResolvedValue({} as any);
    const result = await target.sync(1, 'https://example.com', 'Test', 'Summary');
    expect(result.success).toBe(false);
  });

  it('sync creates a new Gist when no GIST_ID exists', async () => {
    mockGetAll.mockResolvedValue({ github_pat: 'ghp_test123' } as any);
    mockSqliteClient.mutate.mockResolvedValue({ success: true, data: undefined });

    // Mock fetch for createGist
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'new-gist-id-123' }),
    } as Response);

    const result = await target.sync(1, 'https://example.com', 'Test', 'Summary');
    expect(result.success).toBe(true);
    expect(mockSet).toHaveBeenCalledWith('gist_id', 'new-gist-id-123');
    expect(mockSqliteClient.mutate).toHaveBeenCalled();
  });

  it('createGist caps an oversized chunked response body', async () => {
    mockGetAll.mockResolvedValue({ github_pat: 'ghp_test123' } as any);
    mockSqliteClient.mutate.mockResolvedValue({ success: true, data: undefined });

    const huge = new Uint8Array(11 * 1024 * 1024); // 11MB, over the 10MB cap
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      body: {
        getReader: () => {
          let sent = false;
          return {
            read: () => {
              if (sent) return Promise.resolve({ done: true, value: undefined });
              sent = true;
              return Promise.resolve({ done: false, value: huge });
            },
            cancel: () => Promise.resolve(),
          };
        },
      },
    } as unknown as Response);

    const result = await target.sync(1, 'https://example.com', 'Test', 'Summary');
    expect(result.success).toBe(false);
  });

  it('testConnection returns false when not configured', async () => {
    mockGetAll.mockResolvedValue({} as any);
    const result = await target.testConnection();
    expect(result.success).toBe(false);
    expect(result.message).toContain('not configured');
  });

  // PBI 2026-10-19-06: these requests carry the PAT, so a 30x must not be
  // followed (a same-origin redirect keeps the header, a cross-origin one leaks
  // it). The mock plays the platform's part: with `redirect: 'error'` a 30x
  // rejects instead of returning a response, so a second request can only appear
  // if the option is missing.
  describe('redirect policy', () => {
    const PAT = 'ghp_test123';

    function platformLikeFetch(): ReturnType<typeof vi.fn> {
      return vi.fn((_url: string, init?: RequestInit) => {
        if (init?.redirect === 'error') {
          return Promise.reject(new TypeError('Failed to fetch'));
        }
        return Promise.resolve({
          ok: false,
          status: 302,
          statusText: 'Found',
          json: () => Promise.resolve({}),
        } as Response);
      });
    }

    it('does not follow a redirect on the connection test (one request, failure)', async () => {
      mockGetAll.mockResolvedValue({ github_pat: PAT } as any);
      const fetchMock = platformLikeFetch();
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await target.testConnection();

      expect(result.success).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect((fetchMock.mock.calls[0]?.[1] as RequestInit).redirect).toBe('error');
      expect(String((fetchMock.mock.calls[0]?.[0] as string))).toContain('/user');
      // PBI 2026-10-21-11: the fetch runs through the standard CSP gate — no
      // skipCspValidation reaches fetchWithTimeout (BDD: fetch に
      // skipCspValidation は渡らない).
      expect((fetchMock.mock.calls[0]?.[1] as RequestInit).skipCspValidation).toBeUndefined();
    });

    it('does not follow a redirect when creating a gist', async () => {
      mockGetAll.mockResolvedValue({ github_pat: PAT } as any);
      mockSqliteClient.mutate.mockResolvedValue({ success: true, data: undefined });
      const fetchMock = platformLikeFetch();
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await target.sync(1, 'https://example.com', 'Test', 'Summary');

      expect(result.success).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect((fetchMock.mock.calls[0]?.[1] as RequestInit).redirect).toBe('error');
    });

    it('does not follow a redirect when updating an existing gist', async () => {
      mockGetAll.mockResolvedValue({ github_pat: PAT, gist_id: 'existing-id' } as any);
      mockSqliteClient.mutate.mockResolvedValue({ success: true, data: undefined });
      const fetchMock = platformLikeFetch();
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await target.sync(1, 'https://example.com', 'Test', 'Summary');

      expect(result.success).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect((fetchMock.mock.calls[0]?.[1] as RequestInit).redirect).toBe('error');
      expect(String((fetchMock.mock.calls[0]?.[0] as string))).toContain('/gists/existing-id');
    });
  });
});
