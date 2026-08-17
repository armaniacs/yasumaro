import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SqliteClient } from '../sqliteClient.js';
import type { OffscreenTransport } from '../offscreenTransport.js';
import type { OffscreenResponse } from '../../messaging/sqliteMessages.js';
import type { SqliteMessageType } from '../../messaging/sqliteMessages.js';

/**
 * Create a mock transport that resolves with the given response.
 */
function createMockTransport(
  responseOrError: (() => Promise<OffscreenResponse>) | Error
): OffscreenTransport {
  return {
    async msgOffscreen(
      _type: SqliteMessageType,
      _payload: Record<string, unknown> = {},
      _traceId: string = ''
    ): Promise<OffscreenResponse> {
      if (responseOrError instanceof Error) {
        throw responseOrError;
      }
      return responseOrError();
    },
  };
}

describe('SqliteClient', () => {
  let client: SqliteClient;
  let mockTransport: OffscreenTransport;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: instant success
    mockTransport = createMockTransport(async () => ({ success: true } as OffscreenResponse));
    client = new SqliteClient(mockTransport);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('init', () => {
    it('sends SQLITE_INIT message via transport', async () => {
      mockTransport = createMockTransport(async () => ({ success: true, initialized: true } as OffscreenResponse));
      client = new SqliteClient(mockTransport);

      const result = await client.init();
      expect(result).toBe(true);
    });

    it('returns false on failure', async () => {
      mockTransport = createMockTransport(async () => ({ success: false, error: 'init failed' } as OffscreenResponse));
      client = new SqliteClient(mockTransport);

      const result = await client.init();
      expect(result).toBe(false);
    });

    it('returns false on exception', async () => {
      mockTransport = createMockTransport(new Error('connection lost'));
      client = new SqliteClient(mockTransport);

      const result = await client.init();
      expect(result).toBe(false);
    });
  });

  describe('queryResult', () => {
    it('returns rows and total on success', async () => {
      mockTransport = createMockTransport(async () => ({
        success: true, rows: [{ id: 1 }], total: 1,
      } as OffscreenResponse));
      client = new SqliteClient(mockTransport);

      const result = await client.queryResult({ limit: 10 });
      expect(result).toEqual({ success: true, data: { rows: [{ id: 1 }], total: 1 } });
    });

    it('returns failure result on failure', async () => {
      mockTransport = createMockTransport(async () => ({ success: false, error: 'Query failed' } as OffscreenResponse));
      client = new SqliteClient(mockTransport);

      const result = await client.queryResult();
      expect(result.success).toBe(false);
    });
  });

  describe('insertResult', () => {
    it('returns id on success', async () => {
      mockTransport = createMockTransport(async () => ({ success: true, id: 42 } as OffscreenResponse));
      client = new SqliteClient(mockTransport);

      const result = await client.insertResult({
        url: 'https://example.com',
        title: 'Test',
        created_at: Date.now(),
      });
      expect(result).toEqual({ success: true, data: { id: 42 } });
    });
  });

  describe('updateResult', () => {
    it('returns success on success', async () => {
      mockTransport = createMockTransport(async () => ({ success: true } as OffscreenResponse));
      client = new SqliteClient(mockTransport);

      const result = await client.updateResult(1, { title: 'Updated' });
      expect(result).toEqual({ success: true, data: undefined });
    });
  });

  describe('deleteResult', () => {
    it('returns success on success', async () => {
      mockTransport = createMockTransport(async () => ({ success: true } as OffscreenResponse));
      client = new SqliteClient(mockTransport);

      const result = await client.deleteResult(1);
      expect(result).toEqual({ success: true, data: undefined });
    });
  });

  describe('getCountResult', () => {
    it('returns count on success', async () => {
      mockTransport = createMockTransport(async () => ({ success: true, count: 42 } as OffscreenResponse));
      client = new SqliteClient(mockTransport);

      const result = await client.getCountResult();
      expect(result).toEqual({ success: true, data: 42 });
    });
  });

  describe('toggleStarResult', () => {
    it('returns is_starred on success', async () => {
      mockTransport = createMockTransport(async () => ({ success: true, is_starred: 1 } as OffscreenResponse));
      client = new SqliteClient(mockTransport);

      const result = await client.toggleStarResult(1);
      expect(result).toEqual({ success: true, data: { is_starred: 1 } });
    });
  });

  describe('clearAllResult', () => {
    it('returns success on success', async () => {
      mockTransport = createMockTransport(async () => ({ success: true } as OffscreenResponse));
      client = new SqliteClient(mockTransport);

      const result = await client.clearAllResult();
      expect(result).toEqual({ success: true, data: undefined });
    });
  });

  describe('getStatus', () => {
    it('returns status data on success', async () => {
      mockTransport = createMockTransport(async () => ({
        success: true,
        initialized: true,
        path: 'opfs',
        fallback: false,
        fts5: true,
        compileOptions: ['SQLITE_FTS5'],
        compileOptionsSource: 'opfs-worker',
      } as OffscreenResponse));
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

  describe('backupDbResult', () => {
    it('reconstructs Uint8Array from number[] returned by offscreen', async () => {
      const bytes = [83, 81, 76, 105, 116, 101]; // "SQLite"
      mockTransport = createMockTransport(async () => ({
        success: true, data: bytes,
      } as OffscreenResponse));
      client = new SqliteClient(mockTransport);

      const result = await client.backupDbResult();
      expect(result).toEqual({ success: true, data: new Uint8Array(bytes) });
    });

    it('returns failure result when backup fails', async () => {
      mockTransport = createMockTransport(async () => ({
        success: false, error: 'backup failed',
      } as OffscreenResponse));
      client = new SqliteClient(mockTransport);

      const result = await client.backupDbResult();
      expect(result.success).toBe(false);
    });
  });

  describe('restoreDbResult', () => {
    it('sends SQLITE_RESTORE with data array and returns success result on success', async () => {
      mockTransport = createMockTransport(async () => ({ success: true } as OffscreenResponse));
      client = new SqliteClient(mockTransport);

      const result = await client.restoreDbResult(new Uint8Array([1, 2, 3]));
      expect(result).toEqual({ success: true, data: undefined });
    });

    it('returns failure result when offscreen reports failure', async () => {
      mockTransport = createMockTransport(async () => ({
        success: false, error: 'restore failed',
      } as OffscreenResponse));
      client = new SqliteClient(mockTransport);

      const result = await client.restoreDbResult(new Uint8Array([1, 2, 3]));
      expect(result.success).toBe(false);
    });

    it('returns failure result when transport throws', async () => {
      mockTransport = createMockTransport(new Error('timeout'));
      client = new SqliteClient(mockTransport);

      const result = await client.restoreDbResult(new Uint8Array([1, 2, 3]));
      expect(result.success).toBe(false);
    });
  });

  describe('isSqliteHealthy', () => {
    it('sends SQLITE_HEALTH_CHECK and returns true on success', async () => {
      mockTransport = createMockTransport(async () => ({ success: true } as OffscreenResponse));
      client = new SqliteClient(mockTransport);

      const result = await client.isSqliteHealthy();
      expect(result).toBe(true);
    });

    it('returns false when offscreen reports failure', async () => {
      mockTransport = createMockTransport(async () => ({
        success: false, error: 'unhealthy',
      } as OffscreenResponse));
      client = new SqliteClient(mockTransport);

      const result = await client.isSqliteHealthy();
      expect(result).toBe(false);
    });

    it('returns false when transport throws', async () => {
      mockTransport = createMockTransport(new Error('timeout'));
      client = new SqliteClient(mockTransport);

      const result = await client.isSqliteHealthy();
      expect(result).toBe(false);
    });
  });

  describe('runOpfsSpikeResult', () => {
    it('returns spike report on success', async () => {
      mockTransport = createMockTransport(async () => ({
        success: true, report: { writeMs: 100, readMs: 50 },
      } as OffscreenResponse));
      client = new SqliteClient(mockTransport);

      const result = await client.runOpfsSpikeResult();
      expect(result).toEqual({ success: true, data: { writeMs: 100, readMs: 50 } });
    });

    it('returns failure result when spike fails', async () => {
      mockTransport = createMockTransport(async () => ({
        success: false, error: 'OPFS Worker unavailable',
      } as OffscreenResponse));
      client = new SqliteClient(mockTransport);

      const result = await client.runOpfsSpikeResult();
      expect(result.success).toBe(false);
    });
  });

  describe('purgeOldRecordsResult', () => {
    it('returns purged count on success', async () => {
      mockTransport = createMockTransport(async () => ({
        success: true, purged: 10,
      } as OffscreenResponse));
      client = new SqliteClient(mockTransport);

      const result = await client.purgeOldRecordsResult();
      expect(result).toEqual({ success: true, data: { purged: 10 } });
    });
  });

  describe('purgeContentResult', () => {
    it('returns purged count on success', async () => {
      mockTransport = createMockTransport(async () => ({
        success: true, purged: 5,
      } as OffscreenResponse));
      client = new SqliteClient(mockTransport);

      const result = await client.purgeContentResult();
      expect(result).toEqual({ success: true, data: { purged: 5 } });
    });
  });

  describe('error classification', () => {
    it('classifies timeout errors', async () => {
      mockTransport = createMockTransport(new Error('Offscreen message timed out'));
      client = new SqliteClient(mockTransport);

      const result = await client.queryResult();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.kind).toBe('timeout');
      }
    });

    it('classifies offscreen errors', async () => {
      mockTransport = createMockTransport(new Error('offscreen document lost'));
      client = new SqliteClient(mockTransport);

      const result = await client.queryResult();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.kind).toBe('offscreen_lost');
      }
    });

    it('classifies quota errors', async () => {
      mockTransport = createMockTransport(new Error('QuotaExceededError'));
      client = new SqliteClient(mockTransport);

      const result = await client.queryResult();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.kind).toBe('quota');
      }
    });

    it('classifies SQLite errors', async () => {
      mockTransport = createMockTransport(new Error('SQLITE_CONSTRAINT'));
      client = new SqliteClient(mockTransport);

      const result = await client.queryResult();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.kind).toBe('sqlite_error');
      }
    });

    it('classifies unknown errors', async () => {
      mockTransport = createMockTransport(new Error('something weird'));
      client = new SqliteClient(mockTransport);

      const result = await client.queryResult();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.kind).toBe('unknown');
      }
    });
  });

  describe('concurrent failures keep their own reason', () => {
    it('gives each concurrent call the error from its own operation', async () => {
      // Create a transport that returns different errors based on message type
      mockTransport = {
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
