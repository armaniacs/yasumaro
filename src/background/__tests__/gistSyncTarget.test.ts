/**
 * gistSyncTarget.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
const mockGetAll = vi.hoisted(() => vi.fn());
const mockSet = vi.hoisted(() => vi.fn());

import { GistSyncTarget } from '../syncTargets/gistSyncTarget.js';

vi.mock('../sqliteClient.js', () => ({
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
vi.mock('../../utils/storage/settingsStore.js', async (importOriginal) => {
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

import { getSettings, saveSettings } from '../../utils/storage.js';

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

  it('testConnection returns false when not configured', async () => {
    mockGetAll.mockResolvedValue({} as any);
    const result = await target.testConnection();
    expect(result.success).toBe(false);
    expect(result.message).toContain('not configured');
  });
});
