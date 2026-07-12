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

  describe('query()', () => {
    it('returns rows and total on success', async () => {
      setupChromeMock({ success: true, rows: [{ id: 1 }], total: 1 });

      const result = await client.query({ limit: 10 });

      expect(result).toEqual({ rows: [{ id: 1 }], total: 1 });
      expect(recordSqliteSuccess).toHaveBeenCalled();
    });

    it('returns null on failure', async () => {
      setupChromeMock({ success: false, error: 'Query failed' });

      const result = await client.query();

      expect(result).toBeNull();
      expect(recordSqliteFailure).toHaveBeenCalled();
    });

    it('returns null on exception', async () => {
      setupChromeMock(null, 'Connection lost');

      const result = await client.query();

      expect(result).toBeNull();
    });

    it('returns empty rows when response has no rows', async () => {
      setupChromeMock({ success: true, total: 0 });

      const result = await client.query();

      expect(result).toEqual({ rows: [], total: 0 });
    });
  });

  describe('insert()', () => {
    it('returns id on success', async () => {
      setupChromeMock({ success: true, id: 42 });

      const result = await client.insert({
        url: 'https://example.com',
        title: 'Test',
        created_at: Date.now(),
      });

      expect(result).toEqual({ id: 42 });
    });

    it('returns null on failure', async () => {
      setupChromeMock({ success: false, error: 'Insert failed' });

      const result = await client.insert({
        url: 'https://example.com',
        created_at: Date.now(),
      });

      expect(result).toBeNull();
    });
  });

  describe('update()', () => {
    it('returns true on success', async () => {
      setupChromeMock({ success: true });

      const result = await client.update(1, { title: 'Updated' });

      expect(result).toBe(true);
    });

    it('returns false on failure', async () => {
      setupChromeMock({ success: false, error: 'Not found' });

      const result = await client.update(999, { title: 'Updated' });

      expect(result).toBe(false);
    });
  });

  describe('delete()', () => {
    it('returns true on success', async () => {
      setupChromeMock({ success: true });

      const result = await client.delete(1);

      expect(result).toBe(true);
    });

    it('returns false on failure', async () => {
      setupChromeMock({ success: false, error: 'Delete failed' });

      const result = await client.delete(999);

      expect(result).toBe(false);
    });
  });

  describe('getCount()', () => {
    it('returns count on success', async () => {
      setupChromeMock({ success: true, count: 42 });

      const result = await client.getCount();

      expect(result).toBe(42);
    });

    it('returns null on failure', async () => {
      setupChromeMock({ success: false });

      const result = await client.getCount();

      expect(result).toBeNull();
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

    it('returns null on failure', async () => {
      setupChromeMock({ success: false });

      const result = await client.getStatus();

      expect(result).toBeNull();
    });
  });

  describe('clearAll()', () => {
    it('returns true on success', async () => {
      setupChromeMock({ success: true });

      const result = await client.clearAll();

      expect(result).toBe(true);
    });

    it('returns false on failure', async () => {
      setupChromeMock({ success: false });

      const result = await client.clearAll();

      expect(result).toBe(false);
    });
  });

  describe('toggleStar()', () => {
    it('returns is_starred on success', async () => {
      setupChromeMock({ success: true, is_starred: 1 });

      const result = await client.toggleStar(1);

      expect(result).toEqual({ is_starred: 1 });
    });

    it('returns null on failure', async () => {
      setupChromeMock({ success: false });

      const result = await client.toggleStar(1);

      expect(result).toBeNull();
    });
  });

  describe('insertBatch()', () => {
    it('returns count on success', async () => {
      setupChromeMock({ success: true, count: 5 });

      const result = await client.insertBatch([
        { url: 'https://a.com', created_at: Date.now() },
        { url: 'https://b.com', created_at: Date.now() },
      ]);

      expect(result).toEqual({ count: 5 });
    });

    it('returns null on failure', async () => {
      setupChromeMock({ success: false, error: 'Batch insert failed' });

      const result = await client.insertBatch([]);

      expect(result).toBeNull();
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

  describe('restoreDb', () => {
    it('sends SQLITE_RESTORE with data array and returns true on success', async () => {
      const spy = vi.spyOn(client, 'msgOffscreen').mockResolvedValue({ success: true });
      const data = new Uint8Array([1, 2, 3]);

      const result = await client.restoreDb(data);

      expect(result).toBe(true);
      expect(spy).toHaveBeenCalledWith('SQLITE_RESTORE', { data: [1, 2, 3] });
    });

    it('returns false when offscreen reports failure', async () => {
      vi.spyOn(client, 'msgOffscreen').mockResolvedValue({ success: false, error: 'boom' });

      const result = await client.restoreDb(new Uint8Array([9]));

      expect(result).toBe(false);
    });

    it('returns false when msgOffscreen throws', async () => {
      vi.spyOn(client, 'msgOffscreen').mockRejectedValue(new Error('timeout'));

      const result = await client.restoreDb(new Uint8Array([9]));

      expect(result).toBe(false);
    });
  });
});
