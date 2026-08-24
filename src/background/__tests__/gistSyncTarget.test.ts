/**
 * gistSyncTarget.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GistSyncTarget } from '../syncTargets/gistSyncTarget.js';

const mockGetAll = vi.hoisted(() => vi.fn());
const mockSet = vi.hoisted(() => vi.fn());
const mockSetAll = vi.hoisted(() => vi.fn());

vi.mock('../sqliteClient.js', () => ({
  SqliteClient: vi.fn().mockImplementation(() => {
    const qr = vi.fn();
    const ur = vi.fn();
    return {
      queryResult: qr,
      updateResult: ur,
      query: qr,
      mutate: ur,
      maintain: vi.fn(),
    };
  }),
}));

vi.mock('../../utils/storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    StorageKeys: {
      GIST_ENABLED: 'gist_enabled',
      GITHUB_PAT: 'github_pat',
      GIST_ID: 'gist_id',
    },
  };
});

vi.mock('../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    settingsRepository: {
      getAll: mockGetAll,
      set: mockSet,
      setAll: mockSetAll,
      getMany: vi.fn(),
    },
    SettingsRepository: class {
      getAll = mockGetAll;
      set = mockSet;
      setAll = mockSetAll;
      getMany = vi.fn();
    },
  };
});

vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
}));

describe('GistSyncTarget', () => {
  let target: GistSyncTarget;
  let mockSqliteClient: { queryResult: ReturnType<typeof vi.fn>; updateResult: ReturnType<typeof vi.fn>; query: ReturnType<typeof vi.fn>; mutate: ReturnType<typeof vi.fn>; maintain: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    const qr = vi.fn();
    const ur = vi.fn();
    mockSqliteClient = {
      queryResult: qr,
      updateResult: ur,
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
    mockSqliteClient.updateResult.mockResolvedValue({ success: true, data: undefined });

    // Mock fetch for createGist
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'new-gist-id-123' }),
    } as Response);

    const result = await target.sync(1, 'https://example.com', 'Test', 'Summary');
    expect(result.success).toBe(true);
    expect(mockSet).toHaveBeenCalledWith('gist_id', 'new-gist-id-123');
    expect(mockSqliteClient.updateResult).toHaveBeenCalled();
  });

  it('testConnection returns false when not configured', async () => {
    mockGetAll.mockResolvedValue({} as any);
    const result = await target.testConnection();
    expect(result.success).toBe(false);
    expect(result.message).toContain('not configured');
  });
});
