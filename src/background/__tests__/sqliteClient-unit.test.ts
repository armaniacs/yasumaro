/**
 * sqliteClient-unit.test.ts
 * Unit tests for SqliteClient — Gap 6 from coverage audit
 * Tests individual methods via mocked chrome.runtime.sendMessage
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn(),
  logError: vi.fn(),
  ErrorCode: { STORAGE_READ_FAILURE: 'STRG_RD_001' },
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
}));

vi.mock('../../utils/errorUtils.js', () => ({
  errorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

vi.mock('../sqliteAlert.js', () => ({
  recordSqliteSuccess: vi.fn(),
  recordSqliteFailure: vi.fn(),
}));

import { SqliteClient } from '../sqliteClient.js';
import { recordSqliteSuccess, recordSqliteFailure } from '../sqliteAlert.js';

// Helper to simulate chrome.runtime.sendMessage callback pattern
function setupChromeMock(response: unknown, error?: string) {
  (globalThis as any).chrome = {
    offscreen: {
      hasDocument: vi.fn().mockResolvedValue(true),
      createDocument: vi.fn().mockResolvedValue(undefined),
      Reason: { WORKERS: 'WORKERS', LOCAL_STORAGE: 'LOCAL_STORAGE' },
    },
    runtime: {
      sendMessage: vi.fn((_msg: unknown, callback: (response: unknown) => void) => {
        if (error) {
          (globalThis as any).chrome.runtime.lastError = { message: error };
        } else {
          (globalThis as any).chrome.runtime.lastError = undefined;
        }
        callback(response);
      }),
      lastError: undefined as { message: string } | undefined,
    },
  };
}

describe('SqliteClient — unit tests', () => {
  let client: SqliteClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new SqliteClient();
  });

  describe('queryResult()', () => {
    it('returns rows and total on success', async () => {
      setupChromeMock({ success: true, rows: [{ id: 1 }], total: 1 });

      const result = await client.queryResult({ limit: 10 });

      expect(result).toEqual({ success: true, data: { rows: [{ id: 1 }], total: 1 } });
      expect(recordSqliteSuccess).toHaveBeenCalled();
    });

    it('returns failure result on failure', async () => {
      setupChromeMock({ success: false, error: 'Query failed' });

      const result = await client.queryResult();

      expect(result).toEqual({ success: false, error: expect.anything() });
      expect(recordSqliteFailure).toHaveBeenCalled();
    });

    it('returns failure result on exception', async () => {
      setupChromeMock(null, 'Connection lost');

      const result = await client.queryResult();

      expect(result).toEqual({ success: false, error: expect.anything() });
    });

    it('returns empty rows when response has no rows', async () => {
      setupChromeMock({ success: true, total: 0 });

      const result = await client.queryResult();

      expect(result).toEqual({ success: true, data: { rows: [], total: 0 } });
    });
  });

  describe('typed response decoding (PBI-04)', () => {
    it('getCountResult returns the count directly, not coerced', async () => {
      setupChromeMock({ success: true, count: 7 });

      const result = await client.getCountResult();

      expect(result).toEqual({ success: true, data: 7 });
    });

    it('getCountResult reports a missing count as a failure instead of masking it to 0', async () => {
      // A well-formed offscreen response always carries `count`; a response
      // without it is a bug and must not be silently reported as 0 records.
      setupChromeMock({ success: true });

      const result = await client.getCountResult();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('missing a numeric count');
      }
    });

    it('queryResult propagates total without the legacy `|| 0` mask', async () => {
      setupChromeMock({ success: true, rows: [{ id: 1 }], total: 3 });

      const result = await client.queryResult();

      expect(result).toEqual({ success: true, data: { rows: [{ id: 1 }], total: 3 } });
    });

    it('getStatusResult decodes diagnostic fields from the typed shape', async () => {
      setupChromeMock({
        success: true,
        initialized: true,
        path: 'opfs',
        fallback: false,
        fts5: true,
        compileOptions: ['SQLITE_FTS5'],
        compileOptionsSource: 'opfs-worker',
      });

      const result = await client.getStatus();

      expect(result).toEqual({
        initialized: true,
        path: 'opfs',
        fallback: false,
        fts5: true,
        compileOptions: ['SQLITE_FTS5'],
        compileOptionsSource: 'opfs-worker',
      });
    });
  });

  describe('insertResult()', () => {
    it('returns id on success', async () => {
      setupChromeMock({ success: true, id: 42 });

      const result = await client.insertResult({
        url: 'https://example.com',
        title: 'Test',
        created_at: Date.now(),
      });

      expect(result).toEqual({ success: true, data: { id: 42 } });
    });

    it('returns failure result on failure', async () => {
      setupChromeMock({ success: false, error: 'Insert failed' });

      const result = await client.insertResult({
        url: 'https://example.com',
        created_at: Date.now(),
      });

      expect(result).toEqual({ success: false, error: expect.anything() });
    });
  });

  describe('updateResult()', () => {
    it('returns success result on success', async () => {
      setupChromeMock({ success: true });

      const result = await client.updateResult(1, { title: 'Updated' });

      expect(result).toEqual({ success: true, data: undefined });
    });

    it('returns failure result on failure', async () => {
      setupChromeMock({ success: false, error: 'Not found' });

      const result = await client.updateResult(999, { title: 'Updated' });

      expect(result).toEqual({ success: false, error: expect.anything() });
    });
  });

  describe('deleteResult()', () => {
    it('returns success result on success', async () => {
      setupChromeMock({ success: true });

      const result = await client.deleteResult(1);

      expect(result).toEqual({ success: true, data: undefined });
    });

    it('returns failure result on failure', async () => {
      setupChromeMock({ success: false, error: 'Delete failed' });

      const result = await client.deleteResult(999);

      expect(result).toEqual({ success: false, error: expect.anything() });
    });
  });

  describe('getCountResult()', () => {
    it('returns count on success', async () => {
      setupChromeMock({ success: true, count: 42 });

      const result = await client.getCountResult();

      expect(result).toEqual({ success: true, data: 42 });
    });

    it('returns failure result on failure', async () => {
      setupChromeMock({ success: false });

      const result = await client.getCountResult();

      expect(result).toEqual({ success: false, error: expect.anything() });
    });
  });

  describe('getStatus()', () => {
    it('returns status on success', async () => {
      setupChromeMock({
        success: true,
        initialized: true,
        path: '/data/db.sqlite',
        fallback: false,
        fts5: true,
      });

      const result = await client.getStatus();

      expect(result).toEqual({
        initialized: true,
        path: '/data/db.sqlite',
        fallback: false,
        fts5: true,
        initError: undefined,
        compileOptions: undefined,
        compileOptionsSource: undefined,
      });
    });

    it('returns diagnostic info on failure', async () => {
      setupChromeMock({ success: false, error: 'OPFS Worker unavailable' });

      const result = await client.getStatus();

      expect(result).not.toBeNull();
      expect(result!.initialized).toBe(false);
      expect(result!.path).toBe('');
      expect(result!.fallback).toBe(false);
      expect(result!.fts5).toBe(false);
      expect(result!.initError).toContain('OPFS Worker unavailable');
    });
  });

  describe('clearAllResult()', () => {
    it('returns success result on success', async () => {
      setupChromeMock({ success: true });

      const result = await client.clearAllResult();

      expect(result).toEqual({ success: true, data: undefined });
    });

    it('returns failure result on failure', async () => {
      setupChromeMock({ success: false });

      const result = await client.clearAllResult();

      expect(result).toEqual({ success: false, error: expect.anything() });
    });
  });

  describe('toggleStarResult()', () => {
    it('returns is_starred on success', async () => {
      setupChromeMock({ success: true, is_starred: 1 });

      const result = await client.toggleStarResult(1);

      expect(result).toEqual({ success: true, data: { is_starred: 1 } });
    });

    it('returns failure result on failure', async () => {
      setupChromeMock({ success: false });

      const result = await client.toggleStarResult(1);

      expect(result).toEqual({ success: false, error: expect.anything() });
    });
  });

  describe('insertBatchResult()', () => {
    it('returns count on success', async () => {
      setupChromeMock({ success: true, count: 5 });

      const result = await client.insertBatchResult([
        { url: 'https://a.com', created_at: Date.now() },
        { url: 'https://b.com', created_at: Date.now() },
      ]);

      expect(result).toEqual({ success: true, data: { count: 5 } });
    });

    it('returns a failure result on failure', async () => {
      setupChromeMock({ success: false, error: 'Batch insert failed' });

      const result = await client.insertBatchResult([]);

      expect(result).toMatchObject({ success: false, error: { message: expect.any(String) } });
    });
  });

  describe('ensureOffscreenDocument()', () => {
    it('skips creation if document already exists', async () => {
      setupChromeMock({ success: true });

      await client.ensureOffscreenDocument();
      await client.ensureOffscreenDocument(); // Second call should be skipped

      expect((globalThis as any).chrome.offscreen.hasDocument).toHaveBeenCalledTimes(1);
    });

    it('creates document if not exists', async () => {
      setupChromeMock({ success: true });
      (globalThis as any).chrome.offscreen.hasDocument.mockResolvedValue(false);

      await client.ensureOffscreenDocument();

      expect((globalThis as any).chrome.offscreen.createDocument).toHaveBeenCalled();
    });
  });

  describe('restoreDbResult', () => {
    it('sends SQLITE_RESTORE with data array and returns success result on success', async () => {
      const spy = vi.spyOn(client, 'msgOffscreen').mockResolvedValue({ success: true });
      const data = new Uint8Array([1, 2, 3]);

      const result = await client.restoreDbResult(data);

      expect(result).toEqual({ success: true, data: undefined });
      expect(spy).toHaveBeenCalledWith('SQLITE_RESTORE', { data: [1, 2, 3] }, '');
    });

    it('returns failure result when offscreen reports failure', async () => {
      vi.spyOn(client, 'msgOffscreen').mockResolvedValue({ success: false, error: 'boom' });

      const result = await client.restoreDbResult(new Uint8Array([9]));

      expect(result).toEqual({ success: false, error: expect.anything() });
    });

    it('returns failure result when msgOffscreen throws', async () => {
      vi.spyOn(client, 'msgOffscreen').mockRejectedValue(new Error('timeout'));

      const result = await client.restoreDbResult(new Uint8Array([9]));

      expect(result).toEqual({ success: false, error: expect.anything() });
    });
  });

  describe('isSqliteHealthy', () => {
    it('sends SQLITE_HEALTH_CHECK and returns true on success', async () => {
      const spy = vi.spyOn(client, 'msgOffscreen').mockResolvedValue({ success: true });

      const result = await client.isSqliteHealthy();

      expect(result).toBe(true);
      expect(spy).toHaveBeenCalledWith('SQLITE_HEALTH_CHECK', {}, '');
    });

    it('returns false when offscreen reports failure', async () => {
      vi.spyOn(client, 'msgOffscreen').mockResolvedValue({ success: false, error: 'unhealthy' });

      const result = await client.isSqliteHealthy();

      expect(result).toBe(false);
    });

    it('returns false when msgOffscreen throws', async () => {
      vi.spyOn(client, 'msgOffscreen').mockRejectedValue(new Error('timeout'));

      const result = await client.isSqliteHealthy();

      expect(result).toBe(false);
    });
  });

  /**
   * PBI-21: each call's failure reason must belong to that call.
   *
   * These used to be routed through a single `lastError` field on the client,
   * so a caller reading it after its own call could observe whichever
   * operation happened to fail most recently instead. The field is gone; the
   * reason now travels in the CallResult, which makes the mix-up structurally
   * impossible. These lock that in.
   */
  describe('concurrent failures keep their own reason', () => {
    it('gives each concurrent call the error from its own operation', async () => {
      // The slower call fails first-in/last-out, so a shared "most recent
      // failure" slot would hand the wrong reason to at least one of them.
      vi.spyOn(client, 'msgOffscreen').mockImplementation(async (type: string) => {
        if (type === 'SQLITE_DELETE') {
          await new Promise(resolve => setTimeout(resolve, 20));
          throw new Error('quota exceeded');
        }
        throw new Error('request timed out');
      });

      const [deleteResult, clearResult] = await Promise.all([
        client.deleteResult(1),
        client.clearAllResult(),
      ]);

      expect(deleteResult.success).toBe(false);
      expect(clearResult.success).toBe(false);
      if (!deleteResult.success && !clearResult.success) {
        expect(deleteResult.error.kind).toBe('quota');
        expect(clearResult.error.kind).toBe('timeout');
      }
    });

    it('does not let a later failure overwrite an earlier success', async () => {
      vi.spyOn(client, 'msgOffscreen').mockImplementation(async (type: string) => {
        if (type === 'SQLITE_TOGGLE_STAR') return { success: true, is_starred: 1 };
        throw new Error('quota exceeded');
      });

      const [toggleResult, deleteResult] = await Promise.all([
        client.toggleStarResult(1),
        client.deleteResult(2),
      ]);

      expect(toggleResult).toEqual({ success: true, data: { is_starred: 1 } });
      expect(deleteResult.success).toBe(false);
    });
  });
});
