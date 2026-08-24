import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MigrationService } from '../migrationService.js';
import { mapLegacyEntryToRecord } from '../migrationService.js';

vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
  logInfo: vi.fn(() => Promise.resolve()),
  logWarn: vi.fn(() => Promise.resolve()),
  logError: vi.fn(() => Promise.resolve()),
  logDebug: vi.fn(() => Promise.resolve()),
  ErrorCode: { INTERNAL_ERROR: 'INT_001', STORAGE_WRITE_FAILURE: 'STO_003' },
}));

describe('mapLegacyEntryToRecord', () => {
  it('maps a minimal entry with url and timestamp', () => {
    const result = mapLegacyEntryToRecord({ url: 'https://x.com', timestamp: 1000 });
    expect(result.url).toBe('https://x.com');
    expect(result.created_at).toBe(1000);
    expect(result.title).toBeNull();
    expect(result.tags).toBeNull();
    expect(result.content).toBeNull();
    expect(result.fallback_triggered).toBe(0);
  });

  it('joins tags array with separator', () => {
    const result = mapLegacyEntryToRecord({ url: 'https://x.com', timestamp: 1, tags: ['dev', 'test'] });
    expect(result.tags).toBe('dev, test');
  });

  it('sets tags to null for empty array', () => {
    const result = mapLegacyEntryToRecord({ url: 'https://x.com', timestamp: 1, tags: [] });
    expect(result.tags).toBeNull();
  });

  it('preserves aiSummary as summary', () => {
    const result = mapLegacyEntryToRecord({ url: 'https://x.com', timestamp: 1, aiSummary: 'AI summary text' });
    expect(result.summary).toBe('AI summary text');
  });

  it('sets summary to null when aiSummary is not a string', () => {
    const result = mapLegacyEntryToRecord({ url: 'https://x.com', timestamp: 1, aiSummary: 42 as unknown as string });
    expect(result.summary).toBeNull();
  });

  it('maps all optional numeric fields', () => {
    const result = mapLegacyEntryToRecord({
      url: 'https://x.com', timestamp: 1,
      sentTokens: 100, receivedTokens: 200,
      pageBytes: 5000, candidateBytes: 4000,
      aiProvider: 'gemini', aiModel: 'pro',
      aiDuration: 3000, obsidianDuration: 500,
      content: 'page content', maskedCount: 3,
      cleansedReason: 'hard', fallbackTriggered: true,
    });
    expect(result.sent_tokens).toBe(100);
    expect(result.received_tokens).toBe(200);
    expect(result.page_bytes).toBe(5000);
    expect(result.candidate_bytes).toBe(4000);
    expect(result.ai_provider).toBe('gemini');
    expect(result.ai_model).toBe('pro');
    expect(result.ai_duration_ms).toBe(3000);
    expect(result.obsidian_duration_ms).toBe(500);
    expect(result.content).toBe('page content');
    expect(result.masked_count).toBe(3);
    expect(result.cleansed_reason).toBe('hard');
    expect(result.fallback_triggered).toBe(1);
  });
});

describe('MigrationService', () => {
  let service: MigrationService;
  let sqliteClient: {
    getStatus: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
    mutate: ReturnType<typeof vi.fn>;
    maintain: ReturnType<typeof vi.fn>;
  };
  let mockStorage: Record<string, unknown>;

  function setupChrome() {
    const storageGet = vi.fn(async (keys: string | string[] | null) => {
      if (keys === null) return { ...mockStorage };
      if (typeof keys === 'string') return { [keys]: mockStorage[keys] ?? undefined };
      if (Array.isArray(keys)) {
        const r: Record<string, unknown> = {};
        for (const k of keys) r[k] = mockStorage[k];
        return r;
      }
      return {};
    });
    const storageSet = vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(mockStorage, items);
    });
    const storageRemove = vi.fn(async (keys: string | string[]) => {
      const ks = Array.isArray(keys) ? keys : [keys];
      for (const k of ks) delete mockStorage[k];
    });
    (globalThis as any).chrome = {
      runtime: { sendMessage: vi.fn(), lastError: undefined },
      storage: { local: { get: storageGet, set: storageSet, remove: storageRemove } },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage = {};
    setupChrome();
    sqliteClient = {
      getStatus: vi.fn().mockResolvedValue({ fallback: false, initialized: true }),
      query: vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } }),
      mutate: vi.fn().mockResolvedValue({ success: true, data: { count: 0 } }),
      maintain: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    };
    service = new MigrationService(sqliteClient as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('run', () => {
    it('completes when already-migrated status is set', async () => {
      mockStorage['yasumaro_migration_status'] = 'completed';
      await service.run();
      expect(sqliteClient.mutate).not.toHaveBeenCalled();
    });

    it('marks fresh_install when no legacy data exists', async () => {
      mockStorage['savedUrlsWithTimestamps'] = [];
      await service.run();
      expect(mockStorage['yasumaro_migration_status']).toBe('fresh_install');
      expect(sqliteClient.mutate).not.toHaveBeenCalled();
    });

    it('migrates data in batches', async () => {
      const entries = Array.from({ length: 250 }, (_, i) => ({
        url: `https://x${i}.com`, timestamp: i,
      }));
      mockStorage['savedUrlsWithTimestamps'] = entries;
      sqliteClient.mutate.mockResolvedValue({ success: true, data: { count: 100 } });

      await service.run();

      // 250 entries / 100 batch = 3 calls (100 + 100 + 50)
      expect(sqliteClient.mutate).toHaveBeenCalledTimes(3);
    });

    it('handles mutate insertBatch returning a failure result', async () => {
      mockStorage['savedUrlsWithTimestamps'] = [
        { url: 'https://a.com', timestamp: 1 },
      ];
      sqliteClient.mutate.mockResolvedValue({ success: false, error: { kind: 'sqlite_error', message: 'insert failed', retriable: false } });

      await service.run();

      expect(mockStorage['yasumaro_migration_status']).not.toBe('completed');
    });

    it('handles mutate insertBatch throwing an error', async () => {
      mockStorage['savedUrlsWithTimestamps'] = [
        { url: 'https://a.com', timestamp: 1 },
      ];
      sqliteClient.mutate.mockRejectedValue(new Error('DB error'));

      await service.run();

      expect(mockStorage['yasumaro_migration_status']).not.toBe('completed');
    });

    it('handles partial batch success', async () => {
      mockStorage['savedUrlsWithTimestamps'] = [
        { url: 'https://a.com', timestamp: 1 },
        { url: 'https://b.com', timestamp: 2 },
        { url: 'https://c.com', timestamp: 3 },
      ];
      sqliteClient.mutate.mockResolvedValue({ success: true, data: { count: 2 } });

      await service.run();

      expect(mockStorage['yasumaro_migration_status']).not.toBe('completed');
    });

    it('handles error in top-level catch', async () => {
      mockStorage['yasumaro_migration_status'] = 'pending';
      const origGet = chrome.storage.local.get;
      (chrome.storage.local.get as any).mockRejectedValue(new Error('Top-level error'));

      // run() must not throw even when storage access fails; the top-level
      // catch inside run() is expected to swallow it.
      await expect(service.run()).resolves.not.toThrow();
    });

    describe('retry limit', () => {
      beforeEach(() => {
        mockStorage['savedUrlsWithTimestamps'] = [
          { url: 'https://a.com', timestamp: 1 },
        ];
        sqliteClient.mutate.mockRejectedValue(new Error('DB error'));
      });

      it('increments the retry count on each failure without reaching the limit', async () => {
        await service.run();
        expect(mockStorage['yasumaro_migration_retry_count']).toBe(1);
        expect(mockStorage['yasumaro_migration_status']).not.toBe('failed_permanently');

        await service.run();
        expect(mockStorage['yasumaro_migration_retry_count']).toBe(2);
        expect(mockStorage['yasumaro_migration_status']).not.toBe('failed_permanently');
      });

      it('sets status to failed_permanently once MAX_MIGRATION_RETRY_COUNT is reached', async () => {
        // MAX_MIGRATION_RETRY_COUNT is 5 — run 5 times to reach the limit
        for (let i = 0; i < 5; i++) {
          await service.run();
        }
        expect(mockStorage['yasumaro_migration_retry_count']).toBe(5);
        expect(mockStorage['yasumaro_migration_status']).toBe('failed_permanently');
      });

      it('skips migration entirely once status is failed_permanently', async () => {
        mockStorage['yasumaro_migration_status'] = 'failed_permanently';
        mockStorage['yasumaro_migration_retry_count'] = 5;

        await service.run();

        // mutate should not be called — run() should short-circuit
        expect(sqliteClient.mutate).not.toHaveBeenCalled();
      });

      it('resets the retry count once migration succeeds', async () => {
        await service.run(); // fails once, retryCount = 1
        expect(mockStorage['yasumaro_migration_retry_count']).toBe(1);

        // Now make the next attempt succeed
        sqliteClient.mutate.mockResolvedValue({ success: true, data: { count: 1 } });
        await service.run();

        expect(mockStorage['yasumaro_migration_status']).toBe('completed');
        expect(mockStorage['yasumaro_migration_retry_count']).toBeUndefined();
      });
    });
  });

  describe('backfillDiagnosticMetadata', () => {
    it('returns {0,0} when no storage entries', async () => {
      const result = await service.backfillDiagnosticMetadata();
      expect(result).toEqual({ updated: 0, total: 0 });
    });

    it('returns {0,0} when storage entries have no diagnostic data', async () => {
      mockStorage['savedUrlsWithTimestamps'] = [
        { url: 'https://a.com', timestamp: 1000 },
      ];
      const result = await service.backfillDiagnosticMetadata();
      expect(result).toEqual({ updated: 0, total: 0 });
    });

    it('updates SQLite rows that lack diagnostic data', async () => {
      mockStorage['savedUrlsWithTimestamps'] = [
        { url: 'https://a.com', timestamp: 60000, sentTokens: 50, pageBytes: 2000 },
      ];
      sqliteClient.query.mockResolvedValue({
        success: true,
        data: {
          rows: [
            { id: 1, url: 'https://a.com', created_at: 60000, sent_tokens: null, received_tokens: null },
          ],
          total: 1,
        },
      });
      sqliteClient.mutate.mockResolvedValue({ success: true, data: undefined });

      const result = await service.backfillDiagnosticMetadata();
      expect(result.updated).toBe(1);
      expect(sqliteClient.mutate).toHaveBeenCalledWith(expect.objectContaining({ type: 'update', id: 1, changes: expect.objectContaining({
        sent_tokens: 50,
        page_bytes: 2000,
      }) }));
    });

    it('skips entries that already have diagnostic data', async () => {
      mockStorage['savedUrlsWithTimestamps'] = [
        { url: 'https://a.com', timestamp: 60000, sentTokens: 50 },
      ];
      sqliteClient.query.mockResolvedValue({
        success: true,
        data: {
          rows: [
            { id: 1, url: 'https://a.com', created_at: 60000, sent_tokens: 50, received_tokens: null },
          ],
          total: 1,
        },
      });

      const result = await service.backfillDiagnosticMetadata();
      expect(result.updated).toBe(0);
    });

    it('returns {0,0} when SQLite query returns no rows', async () => {
      mockStorage['savedUrlsWithTimestamps'] = [
        { url: 'https://a.com', timestamp: 60000, sentTokens: 50 },
      ];
      sqliteClient.query.mockResolvedValue({ success: true, data: { rows: [], total: 0 } });

      const result = await service.backfillDiagnosticMetadata();
      expect(result).toEqual({ updated: 0, total: 0 });
    });

    it('propagates query errors', async () => {
      mockStorage['savedUrlsWithTimestamps'] = [
        { url: 'https://a.com', timestamp: 60000, sentTokens: 50 },
      ];
      sqliteClient.query.mockRejectedValue(new Error('Query failed'));

      await expect(service.backfillDiagnosticMetadata()).rejects.toThrow('Query failed');
    });

    it('returns {0,0} when storageMap is empty (no diagnostic fields)', async () => {
      mockStorage['savedUrlsWithTimestamps'] = [
        { url: 'https://a.com', timestamp: 1000, tags: [] },
      ];
      const result = await service.backfillDiagnosticMetadata();
      expect(result).toEqual({ updated: 0, total: 0 });
    });

    it('handles mutate update returning failure', async () => {
      mockStorage['savedUrlsWithTimestamps'] = [
        { url: 'https://a.com', timestamp: 60000, sentTokens: 50 },
      ];
      sqliteClient.query.mockResolvedValue({
        success: true,
        data: {
          rows: [{ id: 1, url: 'https://a.com', created_at: 60000, sent_tokens: null }],
          total: 1,
        },
      });
      sqliteClient.mutate.mockResolvedValue({
        success: false,
        error: { kind: 'sqlite_error', message: 'update failed', retriable: false },
      });

      const result = await service.backfillDiagnosticMetadata();
      expect(result.updated).toBe(0);
    });

    it('handles null id in SQLite row', async () => {
      mockStorage['savedUrlsWithTimestamps'] = [
        { url: 'https://a.com', timestamp: 60000, sentTokens: 50 },
      ];
      sqliteClient.query.mockResolvedValue({
        success: true,
        data: {
          rows: [{ id: null, url: 'https://a.com', created_at: 60000, sent_tokens: null }],
          total: 1,
        },
      });

      const result = await service.backfillDiagnosticMetadata();
      expect(result.updated).toBe(0);
    });
  });

  describe('cleanupLegacyStorage', () => {
    it('removes legacy keys and returns byte estimate', async () => {
      mockStorage['savedUrlsWithTimestamps'] = [
        { url: 'https://a.com', timestamp: 1, content: 'large content here' },
      ];
      mockStorage['savedUrls'] = ['https://a.com'];
      mockStorage['legacyStoreReadOnly'] = true;

      const result = await service.cleanupLegacyStorage();
      expect(result.removed).toContain('savedUrlsWithTimestamps');
      expect(result.removed).toContain('savedUrls');
      expect(result.totalBytes).toBeGreaterThan(0);
    });

    it('handles error gracefully', async () => {
      (chrome.storage.local.get as any).mockRejectedValue(new Error('Cleanup error'));
      const result = await service.cleanupLegacyStorage();
      expect(result).toEqual({ removed: [], totalBytes: 0 });
    });

    it('returns zero bytes when no legacy data', async () => {
      const result = await service.cleanupLegacyStorage();
      expect(result.totalBytes).toBe(0);
    });
  });

  describe('needsOpfsRecoveryMigration', () => {
    it('returns false when fallback mode is not set', async () => {
      const result = await service.needsOpfsRecoveryMigration();
      expect(result).toBe(false);
    });

    it('returns false when SQLite is still in fallback mode', async () => {
      mockStorage['opfs_fallback_mode'] = true;
      sqliteClient.getStatus.mockResolvedValue({ fallback: true });
      const result = await service.needsOpfsRecoveryMigration();
      expect(result).toBe(false);
    });

    it('returns false when fallback data is malformed', async () => {
      mockStorage['opfs_fallback_mode'] = true;
      mockStorage['FALLBACK_STORAGE_DATA'] = { records: 'not-an-array' };
      const result = await service.needsOpfsRecoveryMigration();
      expect(result).toBe(false);
    });
  });

  describe('migrateOpfsRecovery', () => {
    it('handles missing fallback data key', async () => {
      mockStorage['opfs_fallback_mode'] = true;
      const result = await service.migrateOpfsRecovery();
      expect(result).toEqual({ success: true, migrated: 0 });
    });

    it('handles batch insert returning null', async () => {
      mockStorage['opfs_fallback_mode'] = true;
      mockStorage['FALLBACK_STORAGE_DATA'] = {
        records: [{ url: 'https://a.com', created_at: 1 }],
      };
      sqliteClient.mutate.mockResolvedValue({ success: false, error: { kind: 'sqlite_error', message: 'insert failed', retriable: false } });

      const result = await service.migrateOpfsRecovery();
      expect(result.success).toBe(false);
      expect(result.migrated).toBe(0);
    });

    it('handles batch insert throwing error', async () => {
      mockStorage['opfs_fallback_mode'] = true;
      mockStorage['FALLBACK_STORAGE_DATA'] = {
        records: [{ url: 'https://a.com', created_at: 1 }],
      };
      sqliteClient.mutate.mockRejectedValue(new Error('Batch error'));

      const result = await service.migrateOpfsRecovery();
      expect(result.success).toBe(false);
    });

    it('handles top-level error', async () => {
      (chrome.storage.local.get as any).mockRejectedValue(new Error('Storage error'));

      const result = await service.migrateOpfsRecovery();
      expect(result.success).toBe(false);
    });
  });
});
