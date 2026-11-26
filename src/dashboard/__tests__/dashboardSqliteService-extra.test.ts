import { describe, it, expect, beforeEach, vi } from 'vitest';
import { givenHandshakeResponse, givenHandshakeError } from './helpers/dashboardSqliteMock.js';

function givenResponse(response: any) {
  // PBI 2026-09-04-01: destructive ops require a confirm-token handshake.
  // Route by subtype: create_confirm_token gets a token, the op gets the script.
  givenHandshakeResponse(response);
}

function givenLastError(errorMessage: string) {
  // Handshake-aware: token fetch succeeds, the operation rejects.
  givenHandshakeError(errorMessage);
}

function givenSessionGet(value: Record<string, unknown>) {
  (globalThis as any).chrome.storage.session.get = vi.fn().mockResolvedValue(value);
}

function givenSessionSet() {
  (globalThis as any).chrome.storage.session.set = vi.fn().mockResolvedValue(undefined);
}

import {
  migrateLogs,
  clearAllLogs,
  getSqliteStatus,
  cleanupLegacyStorage,
  backfillMetadata,
  resyncLegacyStorage,
  backupDb,
  restoreDb,
  RESTORE_CHUNK_BYTES,
  importLogs,
  appendToLogs,
  queryAuditLogs,
} from '../dashboardSqliteService.js';
import { base64ToBytes } from '../../utils/crypto/index.js';

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

    it('reports an error when count is missing instead of substituting 0', async () => {
      givenResponse({ success: true });
      const result = await migrateLogs();
      expect(result).toEqual({ error: 'Invalid SQLite response: count' });
    });

    it('reports an error when read is missing instead of treating it as zero', async () => {
      givenResponse({ success: true, count: 1, inserted: 1 });
      const result = await migrateLogs();
      expect(result).toEqual({ error: 'Invalid SQLite response: read' });
    });

    it('reports an error when inserted is missing instead of treating it as zero', async () => {
      givenResponse({ success: true, count: 1, read: 1 });
      const result = await migrateLogs();
      expect(result).toEqual({ error: 'Invalid SQLite response: inserted' });
    });

    it('carries the reason on rejection', async () => {
      givenLastError('Connection failed');
      const result = await migrateLogs();
      expect(result).toEqual({ error: expect.stringContaining('Connection failed') });
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
      expect(result).toEqual({ error: 'SQLite request timed out. The database may still be initializing.' });
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
        opfsMigrationV2RecordCount: null,
        opfsLegacyDbPath: null,
        idbLegacyDbName: null,
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
        opfsMigrationV2RecordCount: null,
        opfsLegacyDbPath: null,
        idbLegacyDbName: null,
      });
    });

    it('returns diagnostic info on failed response', async () => {
      givenResponse({ success: false, error: 'Query failed' });
      const result = await getSqliteStatus();
      expect(result).toEqual({
        initialized: false, path: '', fallback: false, fts5: false,
        initError: 'Query failed',
      });
    });

    it('returns diagnostic info on rejection', async () => {
      givenLastError('Timeout');
      const result = await getSqliteStatus();
      expect(result).toEqual({
        initialized: false, path: '', fallback: false, fts5: false,
        initError: 'SQLite request timed out. The database may still be initializing.',
      });
    });

    it.each(['initialized', 'fallback', 'fts5'] as const)(
      'rejects a non-boolean %s value in a successful response',
      async (field) => {
        givenResponse({
          success: true,
          initialized: true,
          path: '/db.sqlite3',
          fallback: false,
          fts5: true,
          [field]: 'true',
        });

        const result = await getSqliteStatus();

        expect(result).toEqual({
          initialized: false,
          path: '',
          fallback: false,
          fts5: false,
          initError: `Invalid SQLite response: ${field}`,
        });
      },
    );

    it.each([
      ['opfsMigrationV2Done', 'invalid'],
      ['opfsMigrationV2LastAttemptedAt', 123],
      ['opfsMigrationV2CompletedAt', {}],
      ['opfsMigrationV2RecordCount', -1],
      ['opfsMigrationV2RecordCount', Number.NaN],
    ] as const)('rejects an invalid %s value', async (field, value) => {
      givenResponse({
        success: true,
        initialized: true,
        path: '/db.sqlite3',
        fallback: false,
        fts5: true,
        [field]: value,
      });

      const result = await getSqliteStatus();

      expect(result).toEqual({
        initialized: false,
        path: '',
        fallback: false,
        fts5: false,
        initError: `Invalid SQLite response: ${field}`,
      });
    });

    it('strictly decodes valid OPFS migration status fields', async () => {
      givenResponse({
        success: true,
        initialized: true,
        path: '/db.sqlite3',
        fallback: false,
        fts5: true,
        opfsMigrationV2Done: true,
        opfsMigrationV2LastAttemptedAt: '2026-08-11T10:00:00.000Z',
        opfsMigrationV2CompletedAt: null,
        opfsMigrationV2RecordCount: 3,
      });

      await expect(getSqliteStatus()).resolves.toMatchObject({
        opfsMigrationV2Done: true,
        opfsMigrationV2LastAttemptedAt: '2026-08-11T10:00:00.000Z',
        opfsMigrationV2CompletedAt: null,
        opfsMigrationV2RecordCount: 3,
      });
    });
  });

  describe('cleanupLegacyStorage', () => {
    it('returns removed keys and bytes on success', async () => {
      givenResponse({ success: true, removed: ['old_key_1', 'old_key_2'], totalBytes: 1024 });
      const result = await cleanupLegacyStorage();
      expect(result).toEqual({ data: { removed: ['old_key_1', 'old_key_2'], totalBytes: 1024 } });
    });

    it('keeps the removed fallback when totalBytes is present', async () => {
      givenResponse({ success: true, totalBytes: 0 });
      const result = await cleanupLegacyStorage();
      expect(result).toEqual({ data: { removed: [], totalBytes: 0 } });
    });

    it('reports an error when totalBytes is missing instead of substituting 0', async () => {
      givenResponse({ success: true, removed: ['old_key_1'] });
      const result = await cleanupLegacyStorage();
      expect(result).toEqual({ error: 'Invalid SQLite response: totalBytes' });
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

    it('reports an error when updated is missing instead of substituting 0', async () => {
      givenResponse({ success: true });
      const result = await backfillMetadata();
      expect(result).toEqual({ error: 'Invalid SQLite response: updated' });
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

  describe('resyncLegacyStorage', () => {
    it('returns examined/written/skipped/total counts on success', async () => {
      givenResponse({ success: true, examined: 8, written: 7, skipped: 1, total: 8 });
      const result = await resyncLegacyStorage();
      expect(result).toEqual({ data: { examined: 8, written: 7, skipped: 1, total: 8 } });
    });

    it('reports an error when written is missing instead of substituting 0', async () => {
      givenResponse({ success: true, examined: 8, skipped: 0, total: 8 });
      const result = await resyncLegacyStorage();
      expect(result).toEqual({ error: 'Invalid SQLite response: written' });
    });

    it('carries the reason from a failed response', async () => {
      givenResponse({ success: false, error: 'Resync not available' });
      const result = await resyncLegacyStorage();
      expect(result).toEqual({ error: 'Resync not available' });
    });

    it('carries the reason on rejection', async () => {
      givenLastError('Failed');
      const result = await resyncLegacyStorage();
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

  describe('restoreDb (chunked staging session)', () => {
    const STAGING = 'restore_incoming_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db';
    const TOKEN = 'test-confirm-token';

    /** Install a sendMessage mock scripted per subtype (independent of call order).
     *  A script value may be a function receiving the payload for per-call answers. */
    function givenScript(script: Record<string, unknown>): { opCalls: Array<Record<string, unknown>> } {
      const opCalls: Array<Record<string, unknown>> = [];
      (globalThis as any).chrome.runtime.sendMessage = vi.fn((message: any) => {
        const subtype = message?.payload?.subtype;
        if (subtype === 'create_confirm_token') {
          return Promise.resolve({ success: true, confirmToken: TOKEN });
        }
        opCalls.push(message.payload);
        const scripted = script[subtype as string];
        const response = typeof scripted === 'function' ? (scripted as (p: unknown) => unknown)(message.payload) : scripted;
        if (response instanceof Error) return Promise.reject(response);
        return Promise.resolve(response);
      });
      return { opCalls };
    }

    it('sends begin -> chunk -> commit and resolves on success', async () => {
      const { opCalls } = givenScript({
        restore_begin: { success: true, stagingName: STAGING },
        restore_chunk: { success: true, written: 2 },
        restore_commit: { success: true },
      });
      const result = await restoreDb(new Uint8Array([10, 20]));
      expect(result).toEqual({ data: undefined });
      expect(opCalls.map((c) => c.subtype)).toEqual(['restore_begin', 'restore_chunk', 'restore_commit']);
      expect(opCalls[0]).toMatchObject({ subtype: 'restore_begin', totalBytes: 2, totalChunks: 1 });
      expect(opCalls[1]).toMatchObject({ subtype: 'restore_chunk', stagingName: STAGING, offset: 0, data: 'ChQ=' });
      expect(opCalls[2]).toMatchObject({ subtype: 'restore_commit', stagingName: STAGING, totalBytes: 2 });
    });

    it('splits larger data into byte-offset chunks of at most RESTORE_CHUNK_BYTES', async () => {
      const { opCalls } = givenScript({
        restore_begin: { success: true, stagingName: STAGING },
        // Echo the chunk's real byte length so the write-verification passes.
        restore_chunk: (payload: unknown) => ({
          success: true,
          written: base64ToBytes((payload as { data: string }).data).byteLength,
        }),
        restore_commit: { success: true },
      });
      const size = RESTORE_CHUNK_BYTES * 2 + 1;
      const data = new Uint8Array(size);
      for (let i = 0; i < size; i++) data[i] = i % 251;
      const result = await restoreDb(data);
      expect(result).toEqual({ data: undefined });

      const chunks = opCalls.filter((c) => c.subtype === 'restore_chunk');
      expect(opCalls[0]).toMatchObject({ totalBytes: size, totalChunks: 3 });
      expect(chunks.map((c) => c.offset)).toEqual([0, RESTORE_CHUNK_BYTES, RESTORE_CHUNK_BYTES * 2]);
      // Every chunk stays within the wire cap; the last chunk carries the tail byte.
      for (const chunk of chunks) {
        const bytes = base64ToBytes(chunk.data as string);
        expect(bytes.byteLength).toBeLessThanOrEqual(RESTORE_CHUNK_BYTES);
      }
      expect(base64ToBytes(chunks[2]!.data as string).byteLength).toBe(1);
      // Round-trip: concatenating the chunks reproduces the snapshot exactly.
      const reassembled = chunks.flatMap((c) => Array.from(base64ToBytes(c.data as string)));
      expect(reassembled).toEqual(Array.from(data));
      expect(opCalls[opCalls.length - 1]).toMatchObject({ subtype: 'restore_commit', stagingName: STAGING, totalBytes: size });
    });

    it('aborts the staging once and surfaces the reason when a chunk fails', async () => {
      const { opCalls } = givenScript({
        restore_begin: { success: true, stagingName: STAGING },
        restore_chunk: { success: false, error: 'staging file disappeared' },
        restore_abort: { success: true },
      });
      const result = await restoreDb(new Uint8Array([1, 2, 3]));
      expect(result).toEqual({ error: 'staging file disappeared' });
      expect(opCalls.map((c) => c.subtype)).toEqual(['restore_begin', 'restore_chunk', 'restore_abort']);
    });

    it('aborts the staging once and surfaces the reason when commit fails', async () => {
      const { opCalls } = givenScript({
        restore_begin: { success: true, stagingName: STAGING },
        restore_chunk: { success: true, written: 1 },
        restore_commit: { success: false, error: 'staged size mismatch' },
        restore_abort: { success: true },
      });
      const result = await restoreDb(new Uint8Array([1]));
      expect(result).toEqual({ error: 'staged size mismatch' });
      expect(opCalls.map((c) => c.subtype)).toEqual(['restore_begin', 'restore_chunk', 'restore_commit', 'restore_abort']);
    });

    it('fails closed on a short write instead of committing truncated bytes', async () => {
      const { opCalls } = givenScript({
        restore_begin: { success: true, stagingName: STAGING },
        restore_chunk: { success: true, written: 0 },
        restore_abort: { success: true },
      });
      const result = await restoreDb(new Uint8Array([1, 2, 3]));
      expect(result).toEqual({ error: expect.stringContaining('write mismatch at offset 0') });
      expect(opCalls.map((c) => c.subtype)).toEqual(['restore_begin', 'restore_chunk', 'restore_abort']);
    });

    it('ignores an abort failure and keeps the original error', async () => {
      const { opCalls } = givenScript({
        restore_begin: { success: true, stagingName: STAGING },
        restore_chunk: { success: false, error: 'transfer broken' },
        restore_abort: { success: false, error: 'cleanup unavailable' },
      });
      const result = await restoreDb(new Uint8Array([1]));
      expect(result).toEqual({ error: 'transfer broken' });
      expect(opCalls.filter((c) => c.subtype === 'restore_abort')).toHaveLength(1);
    });

    it('carries the reason on rejection without an abort when begin itself failed', async () => {
      const { opCalls } = givenScript({
        restore_begin: new Error('Connection failed'),
      });
      const result = await restoreDb(new Uint8Array([1]));
      expect(result).toEqual({ error: expect.stringContaining('Connection failed') });
      // No staging name was ever issued, so no cleanup may be attempted.
      expect(opCalls.filter((c) => c.subtype === 'restore_abort')).toHaveLength(0);
    });

    it('rejects an empty snapshot without sending any message', async () => {
      const { opCalls } = givenScript({});
      const result = await restoreDb(new Uint8Array([]));
      expect(result).toEqual({ error: expect.stringContaining('non-empty') });
      expect(opCalls).toEqual([]);
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

    it('reports an error when inserted is missing instead of substituting 0', async () => {
      givenResponse({ success: true });
      const result = await importLogs(sampleRows);
      expect(result).toEqual({ error: 'Invalid SQLite response: inserted' });
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

    it('reports an error when appended is missing instead of substituting ids.length', async () => {
      givenResponse({ success: true });
      const result = await appendToLogs([1, 2, 3]);
      expect(result).toEqual({ error: 'Invalid SQLite response: appended' });
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

  describe('queryAuditLogs', () => {
    it('returns validated audit rows and total on success', async () => {
      const rows = [{ id: 1, provider: 'cloud', url: 'https://example.com', created_at: 1000 }];
      givenResponse({ success: true, rows, total: 1 });

      const result = await queryAuditLogs();

      expect(result).toEqual({ data: { rows, total: 1 } });
    });

    it('reports an error when the required rows array is missing', async () => {
      givenResponse({ success: true, total: 0 });

      const result = await queryAuditLogs();

      expect(result).toEqual({ error: 'Invalid SQLite response: rows' });
    });

    it('reports an error when an audit row has invalid fields', async () => {
      givenResponse({
        success: true,
        rows: [{ id: 1, provider: 'cloud', url: 'https://example.com' }],
        total: 1,
      });

      const result = await queryAuditLogs();

      expect(result).toEqual({ error: 'Invalid SQLite response: rows' });
    });
  });
});
