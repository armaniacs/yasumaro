import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  LegacyMigrationService,
  mapLegacyEntryToRecord,
  type LegacyUrlEntry,
} from '../legacyMigration.js';
import { InMemoryMigrationStateAdapter } from '../migrationState.js';
import type { SqliteClient } from '../../sqliteClient.js';
import type { BrowsingLogRecord } from '../../../utils/sqlite-types.js';

describe('mapLegacyEntryToRecord', () => {
  it('maps a fully populated legacy entry', () => {
    const entry: LegacyUrlEntry = {
      url: 'https://example.com',
      timestamp: 1_700_000_000_000,
      tags: ['a', 'b'],
      aiSummary: 'summary text',
      content: 'raw content',
      maskedCount: 3,
      cleansedReason: 'hard',
      aiProvider: 'openai',
      aiModel: 'gpt-4',
      aiDuration: 1200,
      obsidianDuration: 300,
      sentTokens: 100,
      receivedTokens: 50,
      originalTokens: 120,
      cleansedTokens: 80,
      pageBytes: 5000,
      candidateBytes: 4000,
      originalBytes: 5500,
      cleansedBytes: 3500,
      aiSummaryOriginalBytes: 200,
      aiSummaryCleansedBytes: 150,
      fallbackTriggered: true,
    };
    const record = mapLegacyEntryToRecord(entry);
    expect(record.url).toBe(entry.url);
    expect(record.created_at).toBe(entry.timestamp);
    expect(record.title).toBeNull();
    expect(record.summary).toBe('summary text');
    expect(record.tags).toBe('a, b');
    expect(record.domain).toBeNull();
    expect(record.fallback_triggered).toBe(1);
    expect(record.ai_provider).toBe('openai');
    expect(record.ai_model).toBe('gpt-4');
    expect(record.ai_duration_ms).toBe(1200);
    expect(record.obsidian_duration_ms).toBe(300);
    expect(record.sent_tokens).toBe(100);
    expect(record.received_tokens).toBe(50);
    expect(record.original_tokens).toBe(120);
    expect(record.cleansed_tokens).toBe(80);
    expect(record.page_bytes).toBe(5000);
    expect(record.candidate_bytes).toBe(4000);
    expect(record.original_bytes).toBe(5500);
    expect(record.cleansed_bytes).toBe(3500);
    expect(record.ai_summary_original_bytes).toBe(200);
    expect(record.ai_summary_cleansed_bytes).toBe(150);
    expect(record.content).toBe('raw content');
    expect(record.masked_count).toBe(3);
    expect(record.cleansed_reason).toBe('hard');
  });

  it('maps a minimal legacy entry (null/undefined branches)', () => {
    const entry: LegacyUrlEntry = {
      url: 'https://example.com',
      timestamp: 1_700_000_000_000,
    };
    const record = mapLegacyEntryToRecord(entry);
    expect(record.tags).toBeNull();
    expect(record.summary).toBeNull();
    expect(record.fallback_triggered).toBe(0);
    expect(record.ai_provider).toBeNull();
    expect(record.sent_tokens).toBeNull();
    expect(record.page_bytes).toBeNull();
  });

  it('maps empty tags array to null', () => {
    const entry: LegacyUrlEntry = {
      url: 'https://example.com',
      timestamp: 1,
      tags: [],
    };
    const record = mapLegacyEntryToRecord(entry);
    expect(record.tags).toBeNull();
  });

  it('maps non-string aiSummary to null', () => {
    const entry: LegacyUrlEntry = {
      url: 'https://example.com',
      timestamp: 1,
      aiSummary: 123 as any,
    };
    const record = mapLegacyEntryToRecord(entry);
    expect(record.summary).toBeNull();
  });

  it('maps false fallbackTriggered to 0', () => {
    const entry: LegacyUrlEntry = {
      url: 'https://example.com',
      timestamp: 1,
      fallbackTriggered: false,
    };
    const record = mapLegacyEntryToRecord(entry);
    expect(record.fallback_triggered).toBe(0);
  });
});

describe('LegacyMigrationService', () => {
  let sqliteClient: Pick<SqliteClient, 'mutate' | 'query'>;
  let state: InMemoryMigrationStateAdapter;
  let service: LegacyMigrationService;

  beforeEach(async () => {
    sqliteClient = {
      mutate: vi.fn(),
      query: vi.fn(),
    };
    state = new InMemoryMigrationStateAdapter();
    service = new LegacyMigrationService(sqliteClient as unknown as SqliteClient, state);
    await chrome.storage.local.remove('savedUrlsWithTimestamps');
  });

  describe('run()', () => {
    it('returns immediately when status is completed', async () => {
      await state.setStatus('completed');
      await service.run();
      expect(await state.getStatus()).toBe('completed');
    });

    it('returns immediately when status is fresh_install', async () => {
      await state.setStatus('fresh_install');
      await service.run();
      expect(await state.getStatus()).toBe('fresh_install');
    });

    it('returns immediately when status is failed_permanently', async () => {
      await state.setStatus('failed_permanently');
      await service.run();
      expect(await state.getStatus()).toBe('failed_permanently');
    });

    it('marks fresh_install when no legacy data exists', async () => {
      await state.setStatus('pending');
      await service.run();
      expect(await state.getStatus()).toBe('fresh_install');
      const store = await chrome.storage.local.get('legacyStoreReadOnly');
      expect(store.legacyStoreReadOnly).toBe(true);
    });

    it('migrates all entries successfully and marks completed', async () => {
      await state.setStatus('pending');
      const entries: LegacyUrlEntry[] = Array.from({ length: 3 }, (_, i) => ({
        url: `https://example.com/${i}`,
        timestamp: 1_700_000_000_000 + i,
      }));
      await chrome.storage.local.set({ savedUrlsWithTimestamps: entries });

      vi.mocked(sqliteClient.mutate).mockResolvedValue({
        success: true,
        data: { count: 3 },
      } as any);

      await service.run();
      expect(await state.getStatus()).toBe('completed');
      expect(sqliteClient.mutate).toHaveBeenCalledTimes(1);
    });

    it('writes progress at interval and end', async () => {
      await state.setStatus('pending');
      const entries: LegacyUrlEntry[] = Array.from({ length: 550 }, (_, i) => ({
        url: `https://example.com/${i}`,
        timestamp: 1_700_000_000_000 + i,
      }));
      await chrome.storage.local.set({ savedUrlsWithTimestamps: entries });

      vi.mocked(sqliteClient.mutate).mockImplementation(async (op: any) => {
        if (op.type === 'insertBatch') {
          return { success: true, data: { count: op.records.length } } as any;
        }
        return { success: true, data: undefined } as any;
      });

      await service.run();
      expect(await state.getStatus()).toBe('completed');
      expect(await state.getProgress()).toBe(550);
      // mutate called 6 times (550 / 100 = 6 batches)
      expect(sqliteClient.mutate).toHaveBeenCalledTimes(6);
    });

    it('handles partial batch success', async () => {
      await state.setStatus('pending');
      const entries: LegacyUrlEntry[] = Array.from({ length: 150 }, (_, i) => ({
        url: `https://example.com/${i}`,
        timestamp: 1_700_000_000_000 + i,
      }));
      await chrome.storage.local.set({ savedUrlsWithTimestamps: entries });

      let callCount = 0;
      vi.mocked(sqliteClient.mutate).mockImplementation(async (op: any) => {
        callCount++;
        if (op.type === 'insertBatch') {
          return { success: true, data: { count: op.records.length - 1 } } as any;
        }
        return { success: true, data: undefined } as any;
      });

      await service.run();
      // partial success marks retry but does not immediately reach max retries
      expect(await state.getStatus()).not.toBe('completed');
      expect(callCount).toBeGreaterThanOrEqual(1);
    });

    it('handles insertBatch failure (result.success === false)', async () => {
      await state.setStatus('pending');
      const entries: LegacyUrlEntry[] = Array.from({ length: 50 }, (_, i) => ({
        url: `https://example.com/${i}`,
        timestamp: 1_700_000_000_000 + i,
      }));
      await chrome.storage.local.set({ savedUrlsWithTimestamps: entries });

      vi.mocked(sqliteClient.mutate).mockResolvedValue({
        success: false,
        error: { message: 'db locked' },
      } as any);

      await service.run();
      expect(await state.getStatus()).not.toBe('completed');
    });

    it('handles insertBatch throwing', async () => {
      await state.setStatus('pending');
      const entries: LegacyUrlEntry[] = Array.from({ length: 50 }, (_, i) => ({
        url: `https://example.com/${i}`,
        timestamp: 1_700_000_000_000 + i,
      }));
      await chrome.storage.local.set({ savedUrlsWithTimestamps: entries });

      vi.mocked(sqliteClient.mutate).mockRejectedValue(new Error('boom'));

      await service.run();
      expect(await state.getStatus()).not.toBe('completed');
    });

    it('records retry and eventually gives up after repeated failures', async () => {
      await state.setStatus('pending');
      const entries: LegacyUrlEntry[] = Array.from({ length: 10 }, (_, i) => ({
        url: `https://example.com/${i}`,
        timestamp: 1_700_000_000_000 + i,
      }));
      await chrome.storage.local.set({ savedUrlsWithTimestamps: entries });

      vi.mocked(sqliteClient.mutate).mockRejectedValue(new Error('always fails'));

      for (let i = 0; i < 5; i++) {
        await service.run();
      }
      expect(await state.getStatus()).toBe('failed_permanently');
      expect(await state.getRetryCount()).toBe(5);

      // subsequent runs short-circuit without incrementing retry count
      await service.run();
      expect(await state.getRetryCount()).toBe(5);
    });

    it('handles outer catch when getStatus itself throws', async () => {
      const throwingState = {
        getStatus: vi.fn().mockRejectedValue(new Error('storage unreachable')),
        setStatus: vi.fn().mockResolvedValue(undefined),
        getProgress: vi.fn().mockResolvedValue(0),
        setProgress: vi.fn().mockResolvedValue(undefined),
        getRetryCount: vi.fn().mockResolvedValue(0),
        setRetryCount: vi.fn().mockResolvedValue(undefined),
      };
      const throwingService = new LegacyMigrationService(
        sqliteClient as unknown as SqliteClient,
        throwingState as any,
      );
      await throwingService.run();
      expect(throwingState.setRetryCount).toHaveBeenCalled();
    });

    it('handles outer catch when retry tracking also throws', async () => {
      const brokenState = {
        getStatus: vi.fn().mockRejectedValue(new Error('storage unreachable')),
        setStatus: vi.fn().mockResolvedValue(undefined),
        getProgress: vi.fn().mockResolvedValue(0),
        setProgress: vi.fn().mockResolvedValue(undefined),
        getRetryCount: vi.fn().mockRejectedValue(new Error('also broken')),
        setRetryCount: vi.fn().mockRejectedValue(new Error('also broken')),
      };
      const brokenService = new LegacyMigrationService(
        sqliteClient as unknown as SqliteClient,
        brokenState as any,
      );
      // should not throw
      await expect(brokenService.run()).resolves.toBeUndefined();
    });

    it('skips rewriting progress when a later insertBatch failure recomputes the same currentProgress already written', async () => {
      // 600 entries in 6 batches of 100. Batches 1-5 (i=0..400) succeed fully, and batch 5
      // (batchesSinceLastWrite reaches PROGRESS_WRITE_INTERVAL=5) triggers a progress write of
      // 500, setting lastWrittenProgress=500. Batch 6 (i=500) then fails: currentProgress =
      // progress(0) + i(500) = 500, which equals lastWrittenProgress — hitting the
      // "equal, skip write" branch.
      await state.setStatus('pending');
      const entries: LegacyUrlEntry[] = Array.from({ length: 600 }, (_, i) => ({
        url: `https://example.com/${i}`,
        timestamp: 1_700_000_000_000 + i,
      }));
      await chrome.storage.local.set({ savedUrlsWithTimestamps: entries });

      vi.mocked(sqliteClient.mutate).mockImplementation(async (op: any) => {
        if (op.type === 'insertBatch') {
          const start = entries.findIndex((e) => e.url === op.records[0].url);
          if (start < 500) {
            return { success: true, data: { count: op.records.length } } as any;
          }
        }
        return { success: false, error: { message: 'db locked' } } as any;
      });

      const setProgressSpy = vi.spyOn(state, 'setProgress');
      await service.run();

      expect(await state.getStatus()).not.toBe('completed');
      // setProgress is called once for the interval write at batch 5 (progress=500).
      // batch 6's failure recomputes currentProgress=500 too, but since it equals
      // lastWrittenProgress it must NOT trigger a second setProgress call.
      expect(setProgressSpy).toHaveBeenCalledTimes(1);
      expect(setProgressSpy).toHaveBeenCalledWith(500);
      expect(await state.getProgress()).toBe(500);
    });

    it('skips rewriting progress when a later thrown batch error recomputes the same currentProgress already written', async () => {
      await state.setStatus('pending');
      const entries: LegacyUrlEntry[] = Array.from({ length: 600 }, (_, i) => ({
        url: `https://example.com/${i}`,
        timestamp: 1_700_000_000_000 + i,
      }));
      await chrome.storage.local.set({ savedUrlsWithTimestamps: entries });

      vi.mocked(sqliteClient.mutate).mockImplementation(async (op: any) => {
        if (op.type === 'insertBatch') {
          const start = entries.findIndex((e) => e.url === op.records[0].url);
          if (start < 500) {
            return { success: true, data: { count: op.records.length } } as any;
          }
        }
        throw new Error('boom');
      });

      const setProgressSpy = vi.spyOn(state, 'setProgress');
      await service.run();

      expect(await state.getStatus()).not.toBe('completed');
      expect(setProgressSpy).toHaveBeenCalledTimes(1);
      expect(setProgressSpy).toHaveBeenCalledWith(500);
      expect(await state.getProgress()).toBe(500);
    });
  });

  describe('backfillDiagnosticMetadata()', () => {
    it('returns zeros when storage is empty', async () => {
      await chrome.storage.local.set({ savedUrlsWithTimestamps: [] });
      const result = await service.backfillDiagnosticMetadata();
      expect(result).toEqual({ updated: 0, total: 0 });
    });

    it('returns zeros when the storage key is entirely absent (fallback to empty array)', async () => {
      await chrome.storage.local.remove('savedUrlsWithTimestamps');
      const result = await service.backfillDiagnosticMetadata();
      expect(result).toEqual({ updated: 0, total: 0 });
    });

    it('returns zeros when no entries have diagnostic data', async () => {
      await chrome.storage.local.set({
        savedUrlsWithTimestamps: [
          { url: 'https://a.com', timestamp: 1_700_000_000_000 },
        ],
      });
      const result = await service.backfillDiagnosticMetadata();
      expect(result).toEqual({ updated: 0, total: 0 });
    });

    it('returns zeros when SQLite query returns no rows', async () => {
      await chrome.storage.local.set({
        savedUrlsWithTimestamps: [
          { url: 'https://a.com', timestamp: 1_700_000_000_000, sentTokens: 10 },
        ],
      });
      vi.mocked(sqliteClient.query).mockResolvedValue({
        success: true,
        data: { rows: [], total: 0 },
      } as any);
      const result = await service.backfillDiagnosticMetadata();
      expect(result).toEqual({ updated: 0, total: 0 });
    });

    it('throws when SQLite query fails', async () => {
      await chrome.storage.local.set({
        savedUrlsWithTimestamps: [
          { url: 'https://a.com', timestamp: 1_700_000_000_000, sentTokens: 10 },
        ],
      });
      vi.mocked(sqliteClient.query).mockResolvedValue({
        success: false,
        error: { message: 'db down' },
      } as any);
      await expect(service.backfillDiagnosticMetadata()).rejects.toThrow('db down');
    });

    it('skips rows with missing id', async () => {
      await chrome.storage.local.set({
        savedUrlsWithTimestamps: [
          { url: 'https://a.com', timestamp: 60_000, sentTokens: 10 },
        ],
      });
      const row: BrowsingLogRecord = {
        url: 'https://a.com',
        created_at: 60_000,
        sent_tokens: null,
      };
      vi.mocked(sqliteClient.query).mockResolvedValue({
        success: true,
        data: { rows: [row], total: 1 },
      } as any);
      const result = await service.backfillDiagnosticMetadata();
      expect(result).toEqual({ updated: 0, total: 1 });
    });

    it('skips rows that already have diagnostic data', async () => {
      await chrome.storage.local.set({
        savedUrlsWithTimestamps: [
          { url: 'https://a.com', timestamp: 60_000, sentTokens: 10 },
        ],
      });
      const row: BrowsingLogRecord = {
        id: 1,
        url: 'https://a.com',
        created_at: 60_000,
        sent_tokens: 5,
      };
      vi.mocked(sqliteClient.query).mockResolvedValue({
        success: true,
        data: { rows: [row], total: 1 },
      } as any);
      const result = await service.backfillDiagnosticMetadata();
      expect(result).toEqual({ updated: 0, total: 1 });
    });

    it('skips when no matching storage entry by key', async () => {
      await chrome.storage.local.set({
        savedUrlsWithTimestamps: [
          { url: 'https://a.com', timestamp: 60_000, sentTokens: 10 },
        ],
      });
      const row: BrowsingLogRecord = {
        id: 1,
        url: 'https://b.com',
        created_at: 60_000,
        sent_tokens: null,
      };
      vi.mocked(sqliteClient.query).mockResolvedValue({
        success: true,
        data: { rows: [row], total: 1 },
      } as any);
      const result = await service.backfillDiagnosticMetadata();
      expect(result).toEqual({ updated: 0, total: 1 });
    });

    it('skips when storage entry lacks diagnostic data', async () => {
      await chrome.storage.local.set({
        savedUrlsWithTimestamps: [
          { url: 'https://a.com', timestamp: 60_000 },
        ],
      });
      const row: BrowsingLogRecord = {
        id: 1,
        url: 'https://a.com',
        created_at: 60_000,
        sent_tokens: null,
      };
      vi.mocked(sqliteClient.query).mockResolvedValue({
        success: true,
        data: { rows: [row], total: 1 },
      } as any);
      // Because the storage entry has no hasData fields, storageMap is empty,
      // so backfill returns zeros before iterating SQLite rows.
      const result = await service.backfillDiagnosticMetadata();
      expect(result).toEqual({ updated: 0, total: 0 });
    });

    it('skips a matching row with no changed fields (entry has receivedTokens but nothing else settable)', async () => {
      // hasData is true via receivedTokens, but every individually-guarded change field is
      // null/undefined, so `changes` stays empty and the row is skipped (Object.keys === 0).
      await chrome.storage.local.set({
        savedUrlsWithTimestamps: [
          { url: 'https://a.com', timestamp: 60_000, receivedTokens: 20 },
        ],
      });
      const row: BrowsingLogRecord = {
        id: 1,
        url: 'https://a.com',
        created_at: 60_000,
        sent_tokens: null,
      };
      vi.mocked(sqliteClient.query).mockResolvedValue({
        success: true,
        data: { rows: [row], total: 1 },
      } as any);
      vi.mocked(sqliteClient.mutate).mockResolvedValue({ success: true, data: undefined } as any);
      const result = await service.backfillDiagnosticMetadata();
      expect(result).toEqual({ updated: 1, total: 1 });
      expect(sqliteClient.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'update',
          id: 1,
          changes: { received_tokens: 20 },
        }),
      );
    });

    it('updates all diagnostic fields including fallbackTriggered=true and content/maskedCount/cleansedReason', async () => {
      await chrome.storage.local.set({
        savedUrlsWithTimestamps: [
          {
            url: 'https://a.com',
            timestamp: 60_000,
            sentTokens: 10,
            receivedTokens: 20,
            originalTokens: 30,
            cleansedTokens: 25,
            pageBytes: 100,
            candidateBytes: 90,
            originalBytes: 80,
            cleansedBytes: 70,
            aiSummaryOriginalBytes: 60,
            aiSummaryCleansedBytes: 50,
            aiProvider: 'openai',
            aiModel: 'gpt-4',
            aiDuration: 500,
            obsidianDuration: 200,
            content: 'body text',
            maskedCount: 2,
            cleansedReason: 'soft',
            fallbackTriggered: true,
          },
        ],
      });
      const row: BrowsingLogRecord = {
        id: 1,
        url: 'https://a.com',
        created_at: 60_000,
        sent_tokens: null,
      };
      vi.mocked(sqliteClient.query).mockResolvedValue({
        success: true,
        data: { rows: [row], total: 1 },
      } as any);
      vi.mocked(sqliteClient.mutate).mockResolvedValue({ success: true, data: undefined } as any);
      const result = await service.backfillDiagnosticMetadata();
      expect(result).toEqual({ updated: 1, total: 1 });
      expect(sqliteClient.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'update',
          id: 1,
          changes: expect.objectContaining({
            sent_tokens: 10,
            received_tokens: 20,
            original_tokens: 30,
            cleansed_tokens: 25,
            page_bytes: 100,
            candidate_bytes: 90,
            original_bytes: 80,
            cleansed_bytes: 70,
            ai_summary_original_bytes: 60,
            ai_summary_cleansed_bytes: 50,
            ai_provider: 'openai',
            ai_model: 'gpt-4',
            ai_duration_ms: 500,
            obsidian_duration_ms: 200,
            content: 'body text',
            masked_count: 2,
            cleansed_reason: 'soft',
            fallback_triggered: 1,
          }),
        }),
      );
    });


    it('sets fallback_triggered to 0 when the legacy entry has fallbackTriggered=false', async () => {
      await chrome.storage.local.set({
        savedUrlsWithTimestamps: [
          {
            url: 'https://a.com',
            timestamp: 60_000,
            sentTokens: 10,
            fallbackTriggered: false,
          },
        ],
      });
      const row: BrowsingLogRecord = {
        id: 1,
        url: 'https://a.com',
        created_at: 60_000,
        sent_tokens: null,
      };
      vi.mocked(sqliteClient.query).mockResolvedValue({
        success: true,
        data: { rows: [row], total: 1 },
      } as any);
      vi.mocked(sqliteClient.mutate).mockResolvedValue({ success: true, data: undefined } as any);
      const result = await service.backfillDiagnosticMetadata();
      expect(result).toEqual({ updated: 1, total: 1 });
      expect(sqliteClient.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: expect.objectContaining({ fallback_triggered: 0 }),
        }),
      );
    });

    it('updates matching rows successfully', async () => {
      await chrome.storage.local.set({
        savedUrlsWithTimestamps: [
          {
            url: 'https://a.com',
            timestamp: 60_000,
            sentTokens: 10,
            receivedTokens: 20,
            aiProvider: 'openai',
          },
        ],
      });
      const row: BrowsingLogRecord = {
        id: 1,
        url: 'https://a.com',
        created_at: 60_000,
        sent_tokens: null,
      };
      vi.mocked(sqliteClient.query).mockResolvedValue({
        success: true,
        data: { rows: [row], total: 1 },
      } as any);
      vi.mocked(sqliteClient.mutate).mockResolvedValue({ success: true, data: undefined } as any);
      const result = await service.backfillDiagnosticMetadata();
      expect(result).toEqual({ updated: 1, total: 1 });
      expect(sqliteClient.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'update', id: 1 }),
      );
    });

    it('counts update failures without throwing', async () => {
      await chrome.storage.local.set({
        savedUrlsWithTimestamps: [
          {
            url: 'https://a.com',
            timestamp: 60_000,
            sentTokens: 10,
          },
        ],
      });
      const row: BrowsingLogRecord = {
        id: 1,
        url: 'https://a.com',
        created_at: 60_000,
        sent_tokens: null,
      };
      vi.mocked(sqliteClient.query).mockResolvedValue({
        success: true,
        data: { rows: [row], total: 1 },
      } as any);
      vi.mocked(sqliteClient.mutate).mockResolvedValue({ success: false, error: { message: 'busy' } } as any);
      const result = await service.backfillDiagnosticMetadata();
      expect(result).toEqual({ updated: 0, total: 1 });
    });
  });

  describe('cleanupLegacyStorage()', () => {
    it('removes keys and returns totalBytes', async () => {
      await chrome.storage.local.set({
        savedUrlsWithTimestamps: [{ url: 'https://a.com', timestamp: 1 }],
        savedUrls: ['https://old.com'],
      });
      const result = await service.cleanupLegacyStorage();
      expect(result.removed).toContain('savedUrlsWithTimestamps');
      expect(result.removed).toContain('savedUrls');
      expect(result.totalBytes).toBeGreaterThan(0);
      const remaining = await chrome.storage.local.get(['savedUrlsWithTimestamps', 'savedUrls', 'legacyStoreReadOnly']);
      expect(remaining.savedUrlsWithTimestamps).toBeUndefined();
      expect(remaining.savedUrls).toBeUndefined();
      expect(remaining.legacyStoreReadOnly).toBeUndefined();
    });

    it('treats a falsy stored value (e.g. empty string) as contributing zero bytes', async () => {
      // Covers the `val ? JSON.stringify(val).length : 0` false branch: only
      // savedUrls is present (falsy-empty), savedUrlsWithTimestamps is absent
      // entirely so chrome.storage.local.get returns no entry for it, and the
      // present value is falsy (empty string) so the ternary takes the 0 branch.
      await chrome.storage.local.remove('savedUrlsWithTimestamps');
      await chrome.storage.local.set({ savedUrls: '' });
      const result = await service.cleanupLegacyStorage();
      expect(result.removed).toEqual(['savedUrlsWithTimestamps', 'savedUrls']);
      expect(result.totalBytes).toBe(0);
    });

    it('handles storage errors gracefully', async () => {
      const originalRemove = chrome.storage.local.remove;
      chrome.storage.local.remove = vi.fn().mockRejectedValue(new Error('storage corrupt'));
      const result = await service.cleanupLegacyStorage();
      expect(result.removed).toEqual([]);
      expect(result.totalBytes).toBe(0);
      chrome.storage.local.remove = originalRemove;
    });
  });
});
