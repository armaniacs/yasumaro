import { describe, it, expect, beforeEach, vi } from 'vitest';

function givenResponse(response: any) {
  (globalThis as any).chrome.runtime.sendMessage = vi.fn(
    (_message: any) => Promise.resolve(response),
  );
}

function givenLastError(errorMessage: string) {
  (globalThis as any).chrome.runtime.sendMessage = vi.fn(
    (_message: any) => Promise.reject(new Error(errorMessage)),
  );
}

function givenSessionGet(value: Record<string, unknown>) {
  (globalThis as any).chrome.storage.session.get = vi.fn().mockResolvedValue(value);
}

function givenSessionSet() {
  (globalThis as any).chrome.storage.session.set = vi.fn().mockResolvedValue(undefined);
}

import {
  migrateLogs,
  runOpfsSpike,
  clearAllLogs,
  getSqliteStatus,
  cleanupLegacyStorage,
  backfillMetadata,
  backupDb,
  restoreDb,
  importLogs,
  appendToLogs,
} from '../dashboardSqliteService.js';

describe('dashboardSqliteService — additional exports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (!(globalThis as any).chrome) (globalThis as any).chrome = {} as any;
    if (!(globalThis as any).chrome.runtime) (globalThis as any).chrome.runtime = {} as any;
    if (!(globalThis as any).chrome.storage) (globalThis as any).chrome.storage = {} as any;
    if (!(globalThis as any).chrome.storage.session) (globalThis as any).chrome.storage.session = {} as any;
    givenSessionGet({});
    givenSessionSet();
  });

  describe('migrateLogs', () => {
    it('returns count, read, inserted on success', async () => {
      givenResponse({ success: true, count: 30, read: 35, inserted: 30 });
      const result = await migrateLogs();
      expect(result).toEqual({ count: 30, read: 35, inserted: 30 });
    });

    it('returns null on failed response', async () => {
      givenResponse({ success: false, error: 'Migration failed' });
      const result = await migrateLogs();
      expect(result).toBeNull();
    });

    it('returns null on rejection', async () => {
      givenLastError('Connection failed');
      const result = await migrateLogs();
      expect(result).toBeNull();
    });
  });

  describe('runOpfsSpike', () => {
    it('returns report on success', async () => {
      const report = { strategy: 'opfs-async-main', steps: [], passed: true, durationMs: 5 };
      givenResponse({ success: true, report });
      const result = await runOpfsSpike();
      expect(result).toEqual(report);
    });

    it('returns null when response has no report', async () => {
      givenResponse({ success: true });
      const result = await runOpfsSpike();
      expect(result).toBeNull();
    });

    it('returns null on failed response', async () => {
      givenResponse({ success: false });
      const result = await runOpfsSpike();
      expect(result).toBeNull();
    });

    it('returns null on rejection', async () => {
      givenLastError('Timeout');
      const result = await runOpfsSpike();
      expect(result).toBeNull();
    });
  });

  describe('clearAllLogs', () => {
    it('returns true on success', async () => {
      givenResponse({ success: true });
      const result = await clearAllLogs();
      expect(result).toBe(true);
    });

    it('returns false on failed response', async () => {
      givenResponse({ success: false });
      const result = await clearAllLogs();
      expect(result).toBe(false);
    });

    it('returns false on rejection', async () => {
      givenLastError('Timeout');
      const result = await clearAllLogs();
      expect(result).toBe(false);
    });
  });

  describe('getSqliteStatus', () => {
    it('returns mapped status fields on success', async () => {
      givenResponse({
        success: true, initialized: true, path: '/db.sqlite3', fallback: false, fts5: true,
        compileOptions: ['WASM', 'FTS5'], compileOptionsSource: 'opfs-worker',
      });
      const result = await getSqliteStatus();
      expect(result).toEqual({
        initialized: true, path: '/db.sqlite3', fallback: false, fts5: true,
        compileOptions: ['WASM', 'FTS5'], compileOptionsSource: 'opfs-worker',
        initError: undefined,
      });
    });

    it('handles missing optional fields', async () => {
      givenResponse({ success: true, initialized: false, path: '', fallback: true, fts5: false });
      const result = await getSqliteStatus();
      expect(result).toEqual({
        initialized: false, path: '', fallback: true, fts5: false,
        compileOptions: undefined, compileOptionsSource: undefined, initError: undefined,
      });
    });

    it('returns null on failed response', async () => {
      givenResponse({ success: false });
      const result = await getSqliteStatus();
      expect(result).toBeNull();
    });

    it('returns null on rejection', async () => {
      givenLastError('Timeout');
      const result = await getSqliteStatus();
      expect(result).toBeNull();
    });
  });

  describe('cleanupLegacyStorage', () => {
    it('returns removed keys and bytes on success', async () => {
      givenResponse({ success: true, removed: ['old_key_1', 'old_key_2'], totalBytes: 1024 });
      const result = await cleanupLegacyStorage();
      expect(result).toEqual({ removed: ['old_key_1', 'old_key_2'], totalBytes: 1024 });
    });

    it('handles missing response fields', async () => {
      givenResponse({ success: true });
      const result = await cleanupLegacyStorage();
      expect(result).toEqual({ removed: [], totalBytes: 0 });
    });

    it('returns null on failed response', async () => {
      givenResponse({ success: false });
      const result = await cleanupLegacyStorage();
      expect(result).toBeNull();
    });

    it('returns null on rejection', async () => {
      givenLastError('Failed');
      const result = await cleanupLegacyStorage();
      expect(result).toBeNull();
    });
  });

  describe('backfillMetadata', () => {
    it('returns updated and total counts on success', async () => {
      givenResponse({ success: true, updated: 5, total: 10 });
      const result = await backfillMetadata();
      expect(result).toEqual({ updated: 5, total: 10 });
    });

    it('returns null on failed response', async () => {
      givenResponse({ success: false });
      const result = await backfillMetadata();
      expect(result).toBeNull();
    });

    it('returns null on rejection', async () => {
      givenLastError('Failed');
      const result = await backfillMetadata();
      expect(result).toBeNull();
    });
  });

  describe('backupDb', () => {
    it('returns Uint8Array from response data', async () => {
      givenResponse({ success: true, data: [1, 2, 3] });
      const result = await backupDb();
      expect(result).toEqual(new Uint8Array([1, 2, 3]));
    });

    it('returns null when response has no data', async () => {
      givenResponse({ success: true });
      const result = await backupDb();
      expect(result).toBeNull();
    });

    it('returns null on failed response', async () => {
      givenResponse({ success: false });
      const result = await backupDb();
      expect(result).toBeNull();
    });

    it('returns null on rejection', async () => {
      givenLastError('Failed');
      const result = await backupDb();
      expect(result).toBeNull();
    });
  });

  describe('restoreDb', () => {
    it('returns true on success', async () => {
      givenResponse({ success: true });
      const result = await restoreDb(new Uint8Array([1, 2, 3]));
      expect(result).toBe(true);
    });

    it('sends data as array in payload', async () => {
      givenResponse({ success: true });
      await restoreDb(new Uint8Array([10, 20]));
      expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ subtype: 'restore_db', data: [10, 20] }),
        }),
      );
    });

    it('returns false on failed response', async () => {
      givenResponse({ success: false });
      const result = await restoreDb(new Uint8Array([]));
      expect(result).toBe(false);
    });

    it('returns false on rejection', async () => {
      givenLastError('Failed');
      const result = await restoreDb(new Uint8Array([]));
      expect(result).toBe(false);
    });
  });

  describe('importLogs', () => {
    const sampleRows = [
      { url: 'https://a.com', created_at: 1000 },
      { url: 'https://b.com', created_at: 2000 },
    ];

    it('returns inserted/skipped/total on success', async () => {
      givenResponse({ success: true, inserted: 2, skipped: 0, total: 2 });
      const result = await importLogs(sampleRows);
      expect(result).toEqual({ inserted: 2, skipped: 0, total: 2 });
    });

    it('returns null on failed response', async () => {
      givenResponse({ success: false, error: 'Import failed' });
      const result = await importLogs(sampleRows);
      expect(result).toBeNull();
    });

    it('returns null on rejection', async () => {
      givenLastError('Failed');
      const result = await importLogs(sampleRows);
      expect(result).toBeNull();
    });
  });

  describe('appendToLogs', () => {
    it('returns success with appended count', async () => {
      givenResponse({ success: true, appended: 5 });
      const result = await appendToLogs([1, 2, 3, 4, 5]);
      expect(result).toEqual({ success: true, appended: 5 });
    });

    it('returns success with ids.length fallback when appended missing', async () => {
      givenResponse({ success: true });
      const result = await appendToLogs([1, 2, 3]);
      expect(result).toEqual({ success: true, appended: 3 });
    });

    it('returns error object when response is failure', async () => {
      givenResponse({ success: false, error: 'Obsidian not configured' });
      const result = await appendToLogs([1]);
      expect(result).toEqual({ success: false, error: 'Obsidian not configured' });
    });

    it('returns default error message when no error in response', async () => {
      givenResponse({ success: false });
      const result = await appendToLogs([1]);
      expect(result).toEqual({ success: false, error: 'Append failed' });
    });

    it('returns null on rejection', async () => {
      givenLastError('Failed');
      const result = await appendToLogs([1]);
      expect(result).toBeNull();
    });
  });
});
