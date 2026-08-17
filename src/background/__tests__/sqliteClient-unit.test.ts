/**
 * sqliteClient-unit.test.ts
 * Unit tests for SqliteClient — Gap 6 from coverage audit
 * Tests individual methods via mock OffscreenTransport (PBI-2026-08-17-13)
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
import type { OffscreenTransport } from '../offscreenTransport.js';
import type { OffscreenResponse } from '../../messaging/sqliteMessages.js';
import type { SqliteMessageType } from '../../messaging/sqliteMessages.js';

/**
 * Create a mock transport that resolves with the given response.
 */
function createMockTransport(response: unknown, error?: string): OffscreenTransport & { lastPayload: Record<string, unknown> | null } {
  let lastPayload: Record<string, unknown> | null = null;
  return {
    lastPayload,
    async msgOffscreen(
      type: SqliteMessageType,
      payload: Record<string, unknown> = {},
      _traceId: string = ''
    ): Promise<OffscreenResponse> {
      lastPayload = payload;
      if (error) {
        throw new Error(error);
      }
      return response as OffscreenResponse;
    },
  };
}

describe('SqliteClient — unit tests', () => {
  let mockTransport: ReturnType<typeof createMockTransport>;
  let client: SqliteClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTransport = createMockTransport({ success: true, rows: [], total: 0 });
    client = new SqliteClient(mockTransport);
  });

  describe('queryResult()', () => {
    it('returns rows and total on success', async () => {
      mockTransport = createMockTransport({ success: true, rows: [{ id: 1 }], total: 1 });
      client = new SqliteClient(mockTransport);

      const result = await client.queryResult({ limit: 10 });

      expect(result).toEqual({ success: true, data: { rows: [{ id: 1 }], total: 1 } });
      expect(recordSqliteSuccess).toHaveBeenCalled();
    });

    it('returns failure result on failure', async () => {
      mockTransport = createMockTransport({ success: false, error: 'Query failed' });
      client = new SqliteClient(mockTransport);

      const result = await client.queryResult();

      expect(result).toEqual({ success: false, error: expect.anything() });
      expect(recordSqliteFailure).toHaveBeenCalled();
    });

    it('returns failure result on exception', async () => {
      mockTransport = createMockTransport(null, 'Connection lost');
      client = new SqliteClient(mockTransport);

      const result = await client.queryResult();

      expect(result).toEqual({ success: false, error: expect.anything() });
    });

    it('returns empty rows when response has no rows', async () => {
      mockTransport = createMockTransport({ success: true, total: 0 });
      client = new SqliteClient(mockTransport);

      const result = await client.queryResult();

      expect(result).toEqual({ success: true, data: { rows: [], total: 0 } });
    });
  });

  describe('typed response decoding (PBI-04)', () => {
    it('getCountResult returns the count directly, not coerced', async () => {
      mockTransport = createMockTransport({ success: true, count: 7 });
      client = new SqliteClient(mockTransport);

      const result = await client.getCountResult();

      expect(result).toEqual({ success: true, data: 7 });
    });

    it('getCountResult reports a missing count as a failure instead of masking it to 0', async () => {
      mockTransport = createMockTransport({ success: true });
      client = new SqliteClient(mockTransport);

      const result = await client.getCountResult();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('missing a numeric count');
      }
    });

    it('queryResult propagates total without the legacy `|| 0` mask', async () => {
      mockTransport = createMockTransport({ success: true, rows: [{ id: 1 }], total: 3 });
      client = new SqliteClient(mockTransport);

      const result = await client.queryResult();

      expect(result).toEqual({ success: true, data: { rows: [{ id: 1 }], total: 3 } });
    });

    it('getStatusResult decodes diagnostic fields from the typed shape', async () => {
      mockTransport = createMockTransport({
        success: true,
        initialized: true,
        path: 'opfs',
        fallback: false,
        fts5: true,
        compileOptions: ['SQLITE_FTS5'],
        compileOptionsSource: 'opfs-worker',
      });
      client = new SqliteClient(mockTransport);

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
      mockTransport = createMockTransport({ success: true, id: 42 });
      client = new SqliteClient(mockTransport);

      const result = await client.insertResult({
        url: 'https://example.com',
        title: 'Test',
        created_at: Date.now(),
      });

      expect(result).toEqual({ success: true, data: { id: 42 } });
    });

    it('returns failure result on failure', async () => {
      mockTransport = createMockTransport({ success: false, error: 'Insert failed' });
      client = new SqliteClient(mockTransport);

      const result = await client.insertResult({
        url: 'https://example.com',
        created_at: Date.now(),
      });

      expect(result).toEqual({ success: false, error: expect.anything() });
    });
  });

  describe('updateResult()', () => {
    it('returns success result on success', async () => {
      mockTransport = createMockTransport({ success: true });
      client = new SqliteClient(mockTransport);

      const result = await client.updateResult(1, { title: 'Updated' });

      expect(result).toEqual({ success: true, data: undefined });
    });

    it('returns failure result on failure', async () => {
      mockTransport = createMockTransport({ success: false, error: 'Not found' });
      client = new SqliteClient(mockTransport);

      const result = await client.updateResult(1, { title: 'Updated' });

      expect(result).toEqual({ success: false, error: expect.anything() });
    });
  });

  describe('deleteResult()', () => {
    it('returns success result on success', async () => {
      mockTransport = createMockTransport({ success: true });
      client = new SqliteClient(mockTransport);

      const result = await client.deleteResult(1);

      expect(result).toEqual({ success: true, data: undefined });
    });

    it('returns failure result on failure', async () => {
      mockTransport = createMockTransport({ success: false, error: 'Delete failed' });
      client = new SqliteClient(mockTransport);

      const result = await client.deleteResult(1);

      expect(result).toEqual({ success: false, error: expect.anything() });
    });
  });

  describe('getCountResult()', () => {
    it('returns count on success', async () => {
      mockTransport = createMockTransport({ success: true, count: 42 });
      client = new SqliteClient(mockTransport);

      const result = await client.getCountResult();

      expect(result).toEqual({ success: true, data: 42 });
    });

    it('returns failure result on failure', async () => {
      mockTransport = createMockTransport({ success: false });
      client = new SqliteClient(mockTransport);

      const result = await client.getCountResult();

      expect(result).toEqual({ success: false, error: expect.anything() });
    });
  });

  describe('toggleStarResult()', () => {
    it('returns is_starred on success', async () => {
      mockTransport = createMockTransport({
        success: true,
        is_starred: 1,
      });
      client = new SqliteClient(mockTransport);

      const result = await client.toggleStarResult(1);

      expect(result).toEqual({ success: true, data: { is_starred: 1 } });
    });

    it('returns failure result on failure', async () => {
      mockTransport = createMockTransport({
        success: false,
        error: 'OPFS Worker unavailable',
      });
      client = new SqliteClient(mockTransport);

      const result = await client.toggleStarResult(1);

      expect(result).toEqual({ success: false, error: expect.anything() });
    });
  });

  describe('clearAllResult()', () => {
    it('returns success result on success', async () => {
      mockTransport = createMockTransport({ success: true });
      client = new SqliteClient(mockTransport);

      const result = await client.clearAllResult();

      expect(result).toEqual({ success: true, data: undefined });
    });
  });

  describe('init()', () => {
    it('returns true on success', async () => {
      mockTransport = createMockTransport({ success: true });
      client = new SqliteClient(mockTransport);

      const result = await client.init();

      expect(result).toBe(true);
    });

    it('returns false on failure', async () => {
      mockTransport = createMockTransport({ success: false, error: 'Init failed' });
      client = new SqliteClient(mockTransport);

      const result = await client.init();

      expect(result).toBe(false);
    });
  });

  describe('isSqliteHealthy()', () => {
    it('returns true on success', async () => {
      mockTransport = createMockTransport({ success: true });
      client = new SqliteClient(mockTransport);

      const result = await client.isSqliteHealthy();

      expect(result).toBe(true);
    });

    it('returns false when transport reports failure', async () => {
      mockTransport = createMockTransport({ success: false, error: 'unhealthy' });
      client = new SqliteClient(mockTransport);

      const result = await client.isSqliteHealthy();

      expect(result).toBe(false);
    });

    it('returns false when transport throws', async () => {
      mockTransport = createMockTransport(null, 'timeout');
      client = new SqliteClient(mockTransport);

      const result = await client.isSqliteHealthy();

      expect(result).toBe(false);
    });
  });

  describe('concurrent failures keep their own reason', () => {
    it('gives each concurrent call the error from its own operation', async () => {
      // Create a transport that returns different errors based on message type
      let callCount = 0;
      mockTransport = {
        lastPayload: null,
        async msgOffscreen(type: SqliteMessageType): Promise<OffscreenResponse> {
          if (type === 'SQLITE_DELETE') {
            await new Promise(resolve => setTimeout(resolve, 20));
            throw new Error('quota exceeded');
          }
          throw new Error('request timed out');
        },
      };
      client = new SqliteClient(mockTransport);

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
      mockTransport = {
        lastPayload: null,
        async msgOffscreen(type: SqliteMessageType): Promise<OffscreenResponse> {
          if (type === 'SQLITE_TOGGLE_STAR') return { success: true, is_starred: 1 } as any;
          throw new Error('quota exceeded');
        },
      };
      client = new SqliteClient(mockTransport);

      const [toggleResult, deleteResult] = await Promise.all([
        client.toggleStarResult(1),
        client.deleteResult(2),
      ]);

      expect(toggleResult).toEqual({ success: true, data: { is_starred: 1 } });
      expect(deleteResult.success).toBe(false);
    });
  });
});
