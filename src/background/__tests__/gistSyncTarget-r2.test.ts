/**
 * gistSyncTarget-r2.test.ts
 * Additional coverage for GistSyncTarget: testConnection, syncBatch, error paths
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
import { addLog } from '../../utils/logger.js';

describe('GistSyncTarget - extended coverage', () => {
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

  describe('isConfigured', () => {
    it('returns false when getSettings throws', async () => {
      vi.mocked(getSettings).mockRejectedValue(new Error('storage error'));
      const result = await target.isConfigured();
      expect(result).toBe(false);
    });
  });

  describe('testConnection', () => {
    it('returns success when GitHub API responds ok', async () => {
      vi.mocked(getSettings).mockResolvedValue({ github_pat: 'ghp_valid' } as any);
      global.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);

      const result = await target.testConnection();

      expect(result).toEqual({ success: true, message: 'Connected to GitHub successfully' });
      expect(global.fetch).toHaveBeenCalledWith('https://api.github.com/user', expect.any(Object));
    });

    it('returns unauthorized message on 401', async () => {
      vi.mocked(getSettings).mockResolvedValue({ github_pat: 'ghp_bad' } as any);
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response);

      const result = await target.testConnection();

      expect(result).toEqual({ success: false, message: 'Invalid GitHub PAT (unauthorized)' });
    });

    it('returns generic error for other status codes', async () => {
      vi.mocked(getSettings).mockResolvedValue({ github_pat: 'ghp_test' } as any);
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);

      const result = await target.testConnection();

      expect(result).toEqual({ success: false, message: 'GitHub API error: 500' });
    });

    it('returns connection failed message on network error', async () => {
      vi.mocked(getSettings).mockResolvedValue({ github_pat: 'ghp_test' } as any);
      global.fetch = vi.fn().mockRejectedValue(new Error('Network failure'));

      const result = await target.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Connection failed');
      expect(result.message).toContain('Network failure');
    });

    it('returns not configured when PAT is absent', async () => {
      vi.mocked(getSettings).mockResolvedValue({} as any);
      const result = await target.testConnection();
      expect(result).toEqual({ success: false, message: 'GitHub PAT not configured' });
    });
  });

  describe('sync', () => {
    it('updates an existing Gist when GIST_ID is set', async () => {
      vi.mocked(getSettings).mockResolvedValue({ github_pat: 'ghp_test', gist_id: 'existing-123' } as any);
      mockSqliteClient.update.mockResolvedValue(true);
      global.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);

      const result = await target.sync(1, 'https://example.com', 'Test', 'Summary');

      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/gists/existing-123',
        expect.objectContaining({ method: 'PATCH' }),
      );
      expect(mockSqliteClient.update).toHaveBeenCalledWith(1, { obsidian_synced: 1 });
      expect(saveSettings).not.toHaveBeenCalled();
    });

    it('returns false when createGist fails', async () => {
      vi.mocked(getSettings).mockResolvedValue({ github_pat: 'ghp_test' } as any);
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 422 } as Response);

      const result = await target.sync(1, 'https://example.com', 'Test', 'Summary');

      expect(result).toBe(false);
      expect(mockSqliteClient.update).not.toHaveBeenCalled();
      expect(addLog).toHaveBeenCalledWith('WARN', 'GistSync: failed (silent skip)', expect.any(Object));
    });

    it('returns false when updateGist fails', async () => {
      vi.mocked(getSettings).mockResolvedValue({ github_pat: 'ghp_test', gist_id: 'existing-123' } as any);
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response);

      const result = await target.sync(1, 'https://example.com', 'Test', 'Summary');

      expect(result).toBe(false);
    });

    it('uses provided markdown argument when given', async () => {
      vi.mocked(getSettings).mockResolvedValue({ github_pat: 'ghp_test' } as any);
      global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 'gist-1' }) } as Response);
      mockSqliteClient.update.mockResolvedValue(true);

      const result = await target.sync(1, 'https://example.com', 'Title', null, '# Custom markdown');

      expect(result).toBe(true);
      const callBody = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(callBody.files['yasumaro-history.md'].content).toBe('# Custom markdown');
    });
  });

  describe('syncBatch', () => {
    it('returns 0 when not configured', async () => {
      vi.mocked(getSettings).mockResolvedValue({} as any);
      const result = await target.syncBatch();
      expect(result).toBe(0);
    });

    it('returns 0 when query returns null', async () => {
      vi.mocked(getSettings).mockResolvedValue({ github_pat: 'ghp_test' } as any);
      mockSqliteClient.query.mockResolvedValue(null);

      const result = await target.syncBatch();
      expect(result).toBe(0);
    });

    it('returns 0 when query returns empty rows', async () => {
      vi.mocked(getSettings).mockResolvedValue({ github_pat: 'ghp_test' } as any);
      mockSqliteClient.query.mockResolvedValue({ rows: [] });

      const result = await target.syncBatch();
      expect(result).toBe(0);
    });

    it('returns 0 when no unsynced rows', async () => {
      vi.mocked(getSettings).mockResolvedValue({ github_pat: 'ghp_test' } as any);
      mockSqliteClient.query.mockResolvedValue({
        rows: [{ id: 1, url: 'https://a.com', obsidian_synced: 1 }],
      });

      const result = await target.syncBatch();
      expect(result).toBe(0);
    });

    it('syncs unsynced rows and returns count', async () => {
      vi.mocked(getSettings).mockResolvedValue({ github_pat: 'ghp_test' } as any);
      mockSqliteClient.query.mockResolvedValue({
        rows: [
          { id: 1, url: 'https://a.com', title: 'A', summary: 'Sum A', obsidian_synced: 0 },
          { id: 2, url: 'https://b.com', title: 'B', summary: null, obsidian_synced: 0 },
        ],
      });
      global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 'gist-new' }) } as Response);
      mockSqliteClient.update.mockResolvedValue(true);

      const result = await target.syncBatch();

      expect(result).toBe(2);
      expect(mockSqliteClient.update).toHaveBeenCalledTimes(2);
    });

    it('returns 0 when query throws', async () => {
      vi.mocked(getSettings).mockResolvedValue({ github_pat: 'ghp_test' } as any);
      mockSqliteClient.query.mockRejectedValue(new Error('db error'));

      const result = await target.syncBatch();
      expect(result).toBe(0);
      expect(addLog).toHaveBeenCalledWith('WARN', 'GistSync: batch failed', expect.any(Object));
    });

    it('skips rows with undefined id', async () => {
      vi.mocked(getSettings).mockResolvedValue({ github_pat: 'ghp_test' } as any);
      mockSqliteClient.query.mockResolvedValue({
        rows: [
          { url: 'https://a.com', title: 'A', obsidian_synced: 0 },
          { id: 2, url: 'https://b.com', title: 'B', obsidian_synced: 0 },
        ],
      });
      global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 'gist-new' }) } as Response);
      mockSqliteClient.update.mockResolvedValue(true);

      const result = await target.syncBatch();

      expect(result).toBe(1);
      expect(mockSqliteClient.update).toHaveBeenCalledTimes(1);
    });
  });
});
