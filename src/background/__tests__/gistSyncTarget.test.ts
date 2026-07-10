/**
 * gistSyncTarget.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GistSyncTarget } from '../syncTargets/gistSyncTarget.js';

vi.mock('../sqliteClient.js', () => ({
  SqliteClient: vi.fn().mockImplementation(() => ({
    query: vi.fn(),
    update: vi.fn(),
  })),
}));

vi.mock('../../utils/storage.js', () => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  StorageKeys: {
    GIST_ENABLED: 'gist_enabled',
    GITHUB_PAT: 'github_pat',
    GIST_ID: 'gist_id',
  },
}));

vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
}));

import { getSettings, saveSettings } from '../../utils/storage.js';

describe('GistSyncTarget', () => {
  let target: GistSyncTarget;
  let mockSqliteClient: { query: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSqliteClient = {
      query: vi.fn(),
      update: vi.fn(),
    };
    target = new GistSyncTarget(mockSqliteClient as any);
  });

  it('isConfigured returns false when no PAT is set', async () => {
    vi.mocked(getSettings).mockResolvedValue({} as any);
    expect(await target.isConfigured()).toBe(false);
  });

  it('isConfigured returns true when PAT is set', async () => {
    vi.mocked(getSettings).mockResolvedValue({ github_pat: 'ghp_test123' } as any);
    expect(await target.isConfigured()).toBe(true);
  });

  it('sync returns success false when not configured', async () => {
    vi.mocked(getSettings).mockResolvedValue({} as any);
    const result = await target.sync(1, 'https://example.com', 'Test', 'Summary');
    expect(result.success).toBe(false);
  });

  it('sync creates a new Gist when no GIST_ID exists', async () => {
    vi.mocked(getSettings).mockResolvedValue({ github_pat: 'ghp_test123' } as any);
    mockSqliteClient.update.mockResolvedValue(true);

    // Mock fetch for createGist
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'new-gist-id-123' }),
    } as Response);

    const result = await target.sync(1, 'https://example.com', 'Test', 'Summary');
    expect(result.success).toBe(true);
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ gist_id: 'new-gist-id-123' }));
    expect(mockSqliteClient.update).toHaveBeenCalled();
  });

  it('testConnection returns false when not configured', async () => {
    vi.mocked(getSettings).mockResolvedValue({} as any);
    const result = await target.testConnection();
    expect(result.success).toBe(false);
    expect(result.message).toContain('not configured');
  });
});
