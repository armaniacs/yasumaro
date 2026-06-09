import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObsidianSyncService } from '../obsidianSyncService.js';

describe('ObsidianSyncService', () => {
  let service: ObsidianSyncService;
  let mockObsidianClient: { appendToDailyNote: ReturnType<typeof vi.fn>; testConnection: ReturnType<typeof vi.fn> };
  let mockSqliteClient: { insert: ReturnType<typeof vi.fn>; query: ReturnType<typeof vi.fn>; search: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn>; toggleStar: ReturnType<typeof vi.fn>; getCount: ReturnType<typeof vi.fn>; getStatus: ReturnType<typeof vi.fn> };
  let mockStorage: Record<string, unknown>;

  beforeEach(() => {
    mockStorage = {
      obsidian_api_key: 'test-api-key',
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
      insert: vi.fn().mockResolvedValue({ id: 1 }),
      query: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
      search: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
      update: vi.fn().mockResolvedValue(true),
      delete: vi.fn().mockResolvedValue(true),
      toggleStar: vi.fn().mockResolvedValue({ is_starred: 1 }),
      getCount: vi.fn().mockResolvedValue(42),
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
  });

  describe('sync', () => {
    it('returns false when Obsidian is not configured', async () => {
      mockStorage['obsidian_api_key'] = '';
      const result = await service.sync(1, 'https://example.com', 'Test', null);
      expect(result).toBe(false);
      expect(mockObsidianClient.appendToDailyNote).not.toHaveBeenCalled();
    });

    it('calls appendToDailyNote with markdown and updates obsidian_synced', async () => {
      const result = await service.sync(1, 'https://example.com', 'Test Page', 'A summary');
      expect(result).toBe(true);
      expect(mockObsidianClient.appendToDailyNote).toHaveBeenCalledWith(
        '- [Test Page](https://example.com): A summary'
      );
      expect(mockSqliteClient.update).toHaveBeenCalledWith(1, { obsidian_synced: 1 });
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
      expect(result).toBe(false);
      // Should NOT update obsidian_synced on failure
      expect(mockSqliteClient.update).not.toHaveBeenCalled();
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
});
