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
      expect(result).toEqual({ data: { count: 30, read: 35, inserted: 30 } });
    });

    it('carries the reason from a failed response', async () => {
      givenResponse({ success: false, error: 'Migration failed' });
      const result = await migrateLogs();
      expect(result).toEqual({ error: 'Migration failed' });
    });

    it('carries the reason on rejection', async () => {
      givenLastError('Connection failed');
      const result = await migrateLogs();
      expect(result).toEqual({ error: expect.stringContaining('Connection failed') });
    });
  });

  describe('runOpfsSpike', () => {
    it('returns report on success', async () => {
      const report = { strategy: 'opfs-async-main', steps: [], passed: true, durationMs: 5 };
      givenResponse({ success: true, report });
      const result = await runOpfsSpike();
      expect(result).toEqual({ data: report });
    });

    it('reports a failure when the response has no report', async () => {
      givenResponse({ success: true });
      const result = await runOpfsSpike();
      expect(result).toEqual({ error: 'OPFS spike returned no report' });
    });

    it('carries the reason from a failed response', async () => {
      givenResponse({ success: false, error: 'Worker crashed' });
      const result = await runOpfsSpike();
      expect(result).toEqual({ error: 'Worker crashed' });
    });

    it('carries the reason on rejection', async () => {
      givenLastError('Timeout');
      const result = await runOpfsSpike();
      expect(result).toEqual({ error: expect.stringContaining('Timeout') });
    });
  });

  describe('clearAllLogs', () => {
    it('returns the success side on success', async () => {
      givenResponse({ success: true });
      const result = await clearAllLogs();
      expect(result).toEqual({ data: undefined });
    });

    it('carries the reason from a failed response', async () => {
      givenResponse({ success: false, error: 'Database is locked' });
      const result = await clearAllLogs();
      expect(result).toEqual({ error: 'Database is locked' });
    });

    it('falls back to a fixed message when the response omits the reason', async () => {
      givenResponse({ success: false });
      const result = await clearAllLogs();
      expect(result).toEqual({ error: 'Clear all failed' });
    });

    it('carries the reason on rejection', async () => {
      givenLastError('Timeout');
      const result = await clearAllLogs();
      expect(result).toEqual({ error: expect.stringContaining('Timeout') });
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
        opfsMigrationV2Done: undefined,
        opfsMigrationV2LastAttemptedAt: null,
        opfsMigrationV2CompletedAt: null,
        opfsMigrationV2RecordCount: 0,
      });
    });

    it('handles missing optional fields', async () => {
      givenResponse({ success: true, initialized: false, path: '', fallback: true, fts5: false });
      const result = await getSqliteStatus();
      expect(result).toEqual({
        initialized: false, path: '', fallback: true, fts5: false,
        compileOptions: undefined, compileOptionsSource: undefined, initError: undefined,
        opfsMigrationV2Done: undefined,
        opfsMigrationV2LastAttemptedAt: null,
        opfsMigrationV2CompletedAt: null,
        opfsMigrationV2RecordCount: 0,
      });
    });

    it('returns diagnostic info on failed response', async () => {
      givenResponse({ success: false, error: 'Query failed' });
      const result = await getSqliteStatus();
      expect(result).toEqual({
        initialized: false, path: '', fallback: false, fts5: false,
        compileOptions: undefined, compileOptionsSource: undefined,
        initError: 'Query failed',
      });
    });

    it('returns diagnostic info on rejection', async () => {
      givenLastError('Timeout');
      const result = await getSqliteStatus();
      expect(result).toEqual({
        initialized: false, path: '', fallback: false, fts5: false,
        compileOptions: undefined, compileOptionsSource: undefined,
        initError: 'Timeout',
      });
    });
  });

  describe('cleanupLegacyStorage', () => {
    it('returns removed keys and bytes on success', async () => {
      givenResponse({ success: true, removed: ['old_key_1', 'old_key_2'], totalBytes: 1024 });
      const result = await cleanupLegacyStorage();
      expect(result).toEqual({ data: { removed: ['old_key_1', 'old_key_2'], totalBytes: 1024 } });
    });

    it('handles missing response fields', async () => {
      givenResponse({ success: true });
      const result = await cleanupLegacyStorage();
      expect(result).toEqual({ data: { removed: [], totalBytes: 0 } });
    });

    it('carries the reason from a failed response', async () => {
      givenResponse({ success: false, error: 'Permission denied' });
      const result = await cleanupLegacyStorage();
      expect(result).toEqual({ error: 'Permission denied' });
    });

    it('carries the reason on rejection', async () => {
      givenLastError('Failed');
      const result = await cleanupLegacyStorage();
      expect(result).toEqual({ error: expect.stringContaining('Failed') });
    });
  });

  describe('backfillMetadata', () => {
    it('returns updated and total counts on success', async () => {
      givenResponse({ success: true, updated: 5, total: 10 });
      const result = await backfillMetadata();
      expect(result).toEqual({ data: { updated: 5, total: 10 } });
    });

    it('carries the reason from a failed response', async () => {
      givenResponse({ success: false, error: 'Backfill query failed' });
      const result = await backfillMetadata();
      expect(result).toEqual({ error: 'Backfill query failed' });
    });

    it('carries the reason on rejection', async () => {
      givenLastError('Failed');
      const result = await backfillMetadata();
      expect(result).toEqual({ error: expect.stringContaining('Failed') });
    });
  });

  describe('backupDb', () => {
    it('returns Uint8Array from response data', async () => {
      givenResponse({ success: true, data: 'AQID' });
      const result = await backupDb();
      expect(result).toEqual({ data: new Uint8Array([1, 2, 3]) });
    });

    it('reports an error when a successful response carries no data', async () => {
      // Returning null here would let the caller offer the user an empty file
      // as a completed backup.
      givenResponse({ success: true });
      const result = await backupDb();
      expect(result).toEqual({ error: 'Backup returned no data' });
    });

    it('surfaces the failure reason instead of collapsing it to null', async () => {
      givenResponse({ success: false, error: 'Storage quota exceeded.' });
      const result = await backupDb();
      expect(result).toEqual({ error: 'Storage quota exceeded.' });
    });

    it('falls back to a generic message when the failure has no error text', async () => {
      givenResponse({ success: false });
      const result = await backupDb();
      expect(result).toEqual({ error: 'Backup failed' });
    });

    it('carries the reason on rejection', async () => {
      // The catch branch used to swallow the reason into a bare null; a
      // rejection is exactly the case exportLogsService needs to distinguish
      // from "nothing to back up".
      givenLastError('Failed');
      const result = await backupDb();
      expect(result).toEqual({ error: expect.stringContaining('Failed') });
    });
  });

  describe('restoreDb', () => {
    it('returns the success side on success', async () => {
      givenResponse({ success: true });
      const result = await restoreDb(new Uint8Array([1, 2, 3]));
      expect(result).toEqual({ data: undefined });
    });

    it('sends data as base64 in payload', async () => {
      givenResponse({ success: true });
      await restoreDb(new Uint8Array([10, 20]));
      expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ subtype: 'restore_db', data: 'ChQ=' }),
        }),
      );
    });

    it('carries the reason from a failed response', async () => {
      givenResponse({ success: false, error: 'Corrupt backup file' });
      const result = await restoreDb(new Uint8Array([]));
      expect(result).toEqual({ error: 'Corrupt backup file' });
    });

    it('carries the reason on rejection', async () => {
      givenLastError('Failed');
      const result = await restoreDb(new Uint8Array([]));
      expect(result).toEqual({ error: expect.stringContaining('Failed') });
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
      expect(result).toEqual({ data: { inserted: 2, skipped: 0, total: 2 } });
    });

    it('carries the reason from a failed response', async () => {
      givenResponse({ success: false, error: 'Import failed' });
      const result = await importLogs(sampleRows);
      expect(result).toEqual({ error: 'Import failed' });
    });

    it('carries the reason on rejection', async () => {
      givenLastError('Failed');
      const result = await importLogs(sampleRows);
      expect(result).toEqual({ error: expect.stringContaining('Failed') });
    });
  });

  describe('appendToLogs', () => {
    it('returns success with appended count', async () => {
      givenResponse({ success: true, appended: 5 });
      const result = await appendToLogs([1, 2, 3, 4, 5]);
      expect(result).toEqual({ data: { appended: 5 } });
    });

    it('returns success with ids.length fallback when appended missing', async () => {
      givenResponse({ success: true });
      const result = await appendToLogs([1, 2, 3]);
      expect(result).toEqual({ data: { appended: 3 } });
    });

    it('carries the reason when response is failure', async () => {
      givenResponse({ success: false, error: 'Obsidian not configured' });
      const result = await appendToLogs([1]);
      expect(result).toEqual({ error: 'Obsidian not configured' });
    });

    it('falls back to a fixed message when no error in response', async () => {
      givenResponse({ success: false });
      const result = await appendToLogs([1]);
      expect(result).toEqual({ error: 'Append failed' });
    });

    it('carries the reason on rejection', async () => {
      givenLastError('Failed');
      const result = await appendToLogs([1]);
      expect(result).toEqual({ error: expect.stringContaining('Failed') });
    });
  });
});
