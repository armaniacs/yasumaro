import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObsidianSyncService } from '../obsidianSyncService.js';

describe('ObsidianSyncService', () => {
  let service: ObsidianSyncService;
  let mockObsidianClient: { appendToDailyNote: ReturnType<typeof vi.fn>; testConnection: ReturnType<typeof vi.fn> };
  let mockSqliteClient: { insertResult: ReturnType<typeof vi.fn>; queryResult: ReturnType<typeof vi.fn>; searchResult: ReturnType<typeof vi.fn>; updateResult: ReturnType<typeof vi.fn>; deleteResult: ReturnType<typeof vi.fn>; toggleStarResult: ReturnType<typeof vi.fn>; getCountResult: ReturnType<typeof vi.fn>; getStatus: ReturnType<typeof vi.fn> };
  let mockStorage: Record<string, unknown>;

  beforeEach(() => {
    mockStorage = {
      obsidian_api_key: 'test-api-key-1234567',
    };

    (globalThis as any).chrome = {
      storage: {
        local: {
          get: vi.fn().mockImplementation((keys: string | string[]) => {
            if (Array.isArray(keys)) {
              const result: Record<string, unknown> = {};
              for (const k of keys) result[k] = mockStorage[k];
              return Promise.resolve(result);
            }
            return Promise.resolve({ [keys]: mockStorage[keys] });
          }),
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
    };

    mockObsidianClient = {
      appendToDailyNote: vi.fn().mockResolvedValue(undefined),
      testConnection: vi.fn().mockResolvedValue({ success: true }),
    };

    mockSqliteClient = {
      insertResult: vi.fn().mockResolvedValue({ success: true, data: { id: 1 } }),
      queryResult: vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } }),
      searchResult: vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } }),
      updateResult: vi.fn().mockResolvedValue({ success: true, data: undefined }),
      deleteResult: vi.fn().mockResolvedValue({ success: true, data: undefined }),
      toggleStarResult: vi.fn().mockResolvedValue({ success: true, data: { is_starred: 1 } }),
      getCountResult: vi.fn().mockResolvedValue({ success: true, data: 42 }),
      getStatus: vi.fn().mockResolvedValue({ initialized: true, path: 'yasumaro.db' }),
    };

    service = new ObsidianSyncService(mockObsidianClient as any, mockSqliteClient as any);
  });

  describe('isConfigured', () => {
    it('returns true when API key exists', async () => {
      expect(await service.isConfigured()).toBe(true);
    });

    it('returns false when API key is empty', async () => {
      mockStorage['obsidian_api_key'] = '';
      expect(await service.isConfigured()).toBe(false);
    });

    it('returns false when API key is missing', async () => {
      delete mockStorage['obsidian_api_key'];
      expect(await service.isConfigured()).toBe(false);
    });

    it('returns false when API key is shorter than 16 characters', async () => {
      mockStorage['obsidian_api_key'] = 'short';
      expect(await service.isConfigured()).toBe(false);
    });

    it('returns false when API key is exactly 15 characters (boundary)', async () => {
      mockStorage['obsidian_api_key'] = 'a'.repeat(15);
      expect(await service.isConfigured()).toBe(false);
    });

    it('returns true when API key is exactly 16 characters (boundary)', async () => {
      mockStorage['obsidian_api_key'] = 'a'.repeat(16);
      expect(await service.isConfigured()).toBe(true);
    });

    it('returns false when API key is a number (non-string)', async () => {
      mockStorage['obsidian_api_key'] = 1234567890123456;
      expect(await service.isConfigured()).toBe(false);
    });

    it('returns false when storage access throws', async () => {
      (globalThis as any).chrome.storage.local.get.mockRejectedValue(new Error('storage unavailable'));
      expect(await service.isConfigured()).toBe(false);
    });
  });

  describe('sync', () => {
    it('returns success false when Obsidian is not configured', async () => {
      mockStorage['obsidian_api_key'] = '';
      const result = await service.sync(1, 'https://example.com', 'Test', null);
      expect(result.success).toBe(false);
      expect(mockObsidianClient.appendToDailyNote).not.toHaveBeenCalled();
    });

    it('calls appendToDailyNote with markdown and updates obsidian_synced', async () => {
      const result = await service.sync(1, 'https://example.com', 'Test Page', 'A summary');
      expect(result.success).toBe(true);
      expect(mockObsidianClient.appendToDailyNote).toHaveBeenCalledWith(
        '- [Test Page](https://example.com): A summary'
      );
      expect(mockSqliteClient.updateResult).toHaveBeenCalledWith(1, { obsidian_synced: 1 });
    });

    it('handles title-less URLs correctly', async () => {
      await service.sync(2, 'https://example.com', null, null);
      expect(mockObsidianClient.appendToDailyNote).toHaveBeenCalledWith(
        '- [https://example.com](https://example.com)'
      );
    });

    it('silently skips on Obsidian API failure (does NOT throw)', async () => {
      mockObsidianClient.appendToDailyNote.mockRejectedValue(new Error('Connection refused'));
      const result = await service.sync(1, 'https://example.com', 'Test', null);
      expect(result.success).toBe(false);
      // Should NOT update obsidian_synced on failure
      expect(mockSqliteClient.updateResult).not.toHaveBeenCalled();
    });
  });

  describe('testConnection', () => {
    it('returns success when configured and connection works', async () => {
      const result = await service.testConnection();
      expect(result.success).toBe(true);
      expect(result.message).toContain('success');
    });

    it('returns failure when not configured', async () => {
      mockStorage['obsidian_api_key'] = '';
      const result = await service.testConnection();
      expect(result.success).toBe(false);
      expect(result.message).toContain('not configured');
    });

    it('returns failure on connection error', async () => {
      mockObsidianClient.testConnection.mockRejectedValue(new Error('Timeout'));
      const result = await service.testConnection();
      expect(result.success).toBe(false);
      expect(result.message).toContain('Timeout');
    });
  });

  describe('syncBatch', () => {
    it('returns 0 and does not query when Obsidian is not configured', async () => {
      mockStorage = { obsidian_api_key: '' };
      const result = await service.syncBatch();

      expect(result).toBe(0);
      expect(mockSqliteClient.queryResult).not.toHaveBeenCalled();
      expect(mockObsidianClient.appendToDailyNote).not.toHaveBeenCalled();
    });

    it('returns 0 when no rows are returned from the query', async () => {
      mockSqliteClient.queryResult.mockResolvedValue({ success: true, data: { rows: [], total: 0 } });
      const result = await service.syncBatch();

      expect(result).toBe(0);
      expect(mockObsidianClient.appendToDailyNote).not.toHaveBeenCalled();
    });

    it('returns 0 when every returned row is already synced', async () => {
      mockSqliteClient.queryResult.mockResolvedValue({
        success: true,
        data: {
          rows: [
            { id: 1, url: 'https://a.com', title: 'A', summary: null, obsidian_synced: 1 },
          ],
          total: 1,
        },
      });
      const result = await service.syncBatch();

      expect(result).toBe(0);
      expect(mockObsidianClient.appendToDailyNote).not.toHaveBeenCalled();
    });

    it('syncs each unsynced row and marks obsidian_synced in SQLite', async () => {
      mockSqliteClient.queryResult.mockResolvedValue({
        success: true,
        data: {
          rows: [
            { id: 1, url: 'https://a.com', title: 'A', summary: null, obsidian_synced: 0 },
            { id: 2, url: 'https://b.com', title: 'B', summary: 'B summary', obsidian_synced: 0 },
          ],
          total: 2,
        },
      });
      mockObsidianClient.appendToDailyNote.mockResolvedValue(undefined);

      const result = await service.syncBatch();

      expect(result).toBe(2);
      expect(mockObsidianClient.appendToDailyNote).toHaveBeenCalledTimes(2);
      expect(mockSqliteClient.updateResult).toHaveBeenCalledWith(1, { obsidian_synced: 1 });
      expect(mockSqliteClient.updateResult).toHaveBeenCalledWith(2, { obsidian_synced: 1 });
    });

    it('filters out already-synced rows within a mixed batch', async () => {
      mockSqliteClient.queryResult.mockResolvedValue({
        success: true,
        data: {
          rows: [
            { id: 1, url: 'https://a.com', title: 'A', summary: null, obsidian_synced: 0 },
            { id: 2, url: 'https://b.com', title: 'B', summary: null, obsidian_synced: 1 },
            { id: 3, url: 'https://c.com', title: 'C', summary: null, obsidian_synced: 0 },
          ],
          total: 3,
        },
      });

      const result = await service.syncBatch();

      expect(result).toBe(2);
      expect(mockObsidianClient.appendToDailyNote).toHaveBeenCalledTimes(2);
      // Only ids 1 and 3 (unsynced) get updated.
      expect(mockSqliteClient.updateResult).toHaveBeenCalledWith(1, { obsidian_synced: 1 });
      expect(mockSqliteClient.updateResult).toHaveBeenCalledWith(3, { obsidian_synced: 1 });
      expect(mockSqliteClient.updateResult).not.toHaveBeenCalledWith(2, { obsidian_synced: 1 });
    });

    it('counts only rows whose sync succeeded', async () => {
      mockSqliteClient.queryResult.mockResolvedValue({
        success: true,
        data: {
          rows: [
            { id: 1, url: 'https://a.com', title: 'A', summary: null, obsidian_synced: 0 },
            { id: 2, url: 'https://b.com', title: 'B', summary: null, obsidian_synced: 0 },
          ],
          total: 2,
        },
      });
      mockObsidianClient.appendToDailyNote
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Obsidian down'));

      const result = await service.syncBatch();

      // Row 1 succeeds, row 2 fails silently → count reflects only the success.
      expect(result).toBe(1);
      expect(mockSqliteClient.updateResult).toHaveBeenCalledTimes(1);
      expect(mockSqliteClient.updateResult).toHaveBeenCalledWith(1, { obsidian_synced: 1 });
    });

    it('skips rows with an undefined id', async () => {
      mockSqliteClient.queryResult.mockResolvedValue({
        success: true,
        data: {
          rows: [
            { id: undefined, url: 'https://no-id.com', title: 'No ID', summary: null, obsidian_synced: 0 },
            { id: 5, url: 'https://has-id.com', title: 'Has ID', summary: null, obsidian_synced: 0 },
          ],
          total: 2,
        },
      });

      const result = await service.syncBatch();

      expect(result).toBe(1);
      expect(mockObsidianClient.appendToDailyNote).toHaveBeenCalledTimes(1);
      expect(mockSqliteClient.updateResult).toHaveBeenCalledWith(5, { obsidian_synced: 1 });
    });

    it('propagates a query failure', async () => {
      mockSqliteClient.queryResult.mockRejectedValue(new Error('Query exploded'));

      await expect(service.syncBatch()).rejects.toThrow('Query exploded');
      expect(mockObsidianClient.appendToDailyNote).not.toHaveBeenCalled();
    });
  });
});
