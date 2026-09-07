/**
 * archiveWireDispatch.test.ts (PBI 2026-09-07-22)
 *
 * Covers the table-driven archive dispatch in sqliteMessageHandlers.ts:
 * each of the 14 SQLITE_ARCHIVE_* messages reaches the right backend
 * method with the right args, success fields are projected, backend
 * failures are forwarded verbatim, and empty successes map to the
 * historical error strings.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SqliteMessage } from '../../messaging/sqliteMessages.js';

const backendFake = vi.hoisted(() => ({
  archivePreview: vi.fn(),
  archiveCreate: vi.fn(),
  archiveCleanup: vi.fn(),
  archiveExportChunk: vi.fn(),
  archivePrepareIncoming: vi.fn(),
  archiveRestorePreview: vi.fn(),
  archiveRestore: vi.fn(),
  archiveDeleteByStaging: vi.fn(),
  archiveOpen: vi.fn(),
  archiveQuery: vi.fn(),
  archiveUpdate: vi.fn(),
  archiveSave: vi.fn(),
  archiveClose: vi.fn(),
  archiveStatus: vi.fn(),
}));

const getBackendMock = vi.hoisted(() => vi.fn());

vi.mock('../sqliteEngineHost.js', () => ({
  engine: { getBackend: getBackendMock },
}));

vi.mock('../recordsRepo.js', () => ({
  insert: vi.fn(),
  insertBatch: vi.fn(),
  query: vi.fn(),
  update: vi.fn(),
  hardDelete: vi.fn(),
  toggleStar: vi.fn(),
  getCount: vi.fn(),
  getStatus: vi.fn(),
  serialize: vi.fn(),
  clearAll: vi.fn(),
}));

vi.mock('../auditLogRepo.js', () => ({
  insertAuditLog: vi.fn(),
  queryAuditLog: vi.fn(),
}));

vi.mock('../dbMaintenance.js', () => ({
  sqliteHealthCheck: vi.fn(),
  backupDb: vi.fn(),
  restoreDb: vi.fn(),
  purgeOldRecords: vi.fn(),
  purgeContent: vi.fn(),
}));

import { sqliteMessageHandlers } from '../sqliteMessageHandlers.js';

async function dispatch(type: string, payload: Record<string, unknown> = {}): Promise<unknown> {
  const handler = sqliteMessageHandlers.get(type as never);
  if (!handler) throw new Error(`No handler for ${type}`);
  let response: unknown;
  await handler({ type, payload, traceId: 't' } as SqliteMessage, (r) => { response = r; });
  return response;
}

beforeEach(() => {
  vi.clearAllMocks();
  getBackendMock.mockResolvedValue(backendFake);
});

describe('archiveWireDispatch: routing + projection', () => {
  const cases: Array<{
    type: string;
    payload: Record<string, unknown>;
    method: keyof typeof backendFake;
    backendResult: unknown;
    expected: unknown;
  }> = [
    {
      type: 'SQLITE_ARCHIVE_PREVIEW', payload: { cutoffDate: '2024-01-01', cutoffMs: 1, includeDeleted: false },
      method: 'archivePreview', backendResult: { success: true, preview: { count: 2 } },
      expected: { success: true, preview: { count: 2 } },
    },
    {
      type: 'SQLITE_ARCHIVE_CREATE', payload: { cutoffDate: '2024-01-01', cutoffMs: 1, includeDeleted: false, yasumaroVersion: '1.0.0' },
      method: 'archiveCreate', backendResult: { success: true, stagingName: 's', recordCount: 2 },
      expected: { success: true, stagingName: 's', recordCount: 2 },
    },
    {
      type: 'SQLITE_ARCHIVE_CLEANUP', payload: {},
      method: 'archiveCleanup', backendResult: { success: true, removed: ['a'] },
      expected: { success: true, removed: ['a'] },
    },
    {
      type: 'SQLITE_ARCHIVE_EXPORT', payload: { stagingName: 's', offset: 0, length: 64 },
      method: 'archiveExportChunk', backendResult: { success: true, chunk: [1], nextOffset: 1, total: 1, done: true },
      expected: { success: true, chunk: [1], nextOffset: 1, total: 1, done: true },
    },
    {
      type: 'SQLITE_ARCHIVE_PREPARE_INCOMING', payload: {},
      method: 'archivePrepareIncoming', backendResult: { success: true, stagingName: 's' },
      expected: { success: true, stagingName: 's' },
    },
    {
      type: 'SQLITE_ARCHIVE_RESTORE_PREVIEW', payload: { stagingName: 's' },
      method: 'archiveRestorePreview', backendResult: { success: true, preview: { ok: true } },
      expected: { success: true, preview: { ok: true } },
    },
    {
      type: 'SQLITE_ARCHIVE_RESTORE', payload: { stagingName: 's' },
      method: 'archiveRestore', backendResult: { success: true, restored: 1, restoredDeleted: 0, skipped: 0, skippedInvalid: 0 },
      expected: { success: true, restored: 1, restoredDeleted: 0, skipped: 0, skippedInvalid: 0 },
    },
    {
      type: 'SQLITE_ARCHIVE_DELETE_BY_STAGING', payload: { stagingName: 's' },
      method: 'archiveDeleteByStaging',
      backendResult: { success: true, deleted: 1, remaining: 0, freelistBefore: 2, freelistAfter: 0, vacuumOk: true },
      expected: { success: true, deleted: 1, remaining: 0, freelistBefore: 2, freelistAfter: 0, vacuumOk: true },
    },
    {
      type: 'SQLITE_ARCHIVE_OPEN', payload: { stagingName: 's' },
      method: 'archiveOpen', backendResult: { success: true },
      expected: { success: true },
    },
    {
      type: 'SQLITE_ARCHIVE_QUERY', payload: { stagingName: 's', query: 'q', limit: 10, offset: 0 },
      method: 'archiveQuery', backendResult: { success: true, rows: [{ id: 1 }], total: 1 },
      expected: { success: true, rows: [{ id: 1 }], total: 1 },
    },
    {
      type: 'SQLITE_ARCHIVE_UPDATE', payload: { stagingName: 's', id: 1, changes: { title: 't' } },
      method: 'archiveUpdate', backendResult: { success: true, dirty: true },
      expected: { success: true, dirty: true },
    },
    {
      type: 'SQLITE_ARCHIVE_SAVE', payload: { stagingName: 's' },
      method: 'archiveSave', backendResult: { success: true, dirty: false },
      expected: { success: true, dirty: false },
    },
    {
      type: 'SQLITE_ARCHIVE_CLOSE', payload: { stagingName: 's' },
      method: 'archiveClose', backendResult: { success: true, dirty: false },
      expected: { success: true, dirty: false },
    },
    {
      type: 'SQLITE_ARCHIVE_STATUS', payload: {},
      method: 'archiveStatus', backendResult: { success: true, status: { open: true } },
      expected: { success: true, status: { open: true } },
    },
  ];

  it.each(cases)('$type delegates to $method and projects the response', async ({ type, payload, method, backendResult, expected }) => {
    backendFake[method].mockResolvedValue(backendResult);
    expect(await dispatch(type, payload)).toEqual(expected);
    expect(backendFake[method]).toHaveBeenCalledTimes(1);
  });

  it('forwards arg values for a representative multi-arg op', async () => {
    backendFake.archiveQuery.mockResolvedValue({ success: true, rows: [], total: 0 });
    await dispatch('SQLITE_ARCHIVE_QUERY', { stagingName: 's', query: 'q', limit: 10, offset: 5 });
    expect(backendFake.archiveQuery).toHaveBeenCalledWith('s', 'q', 10, 5);
  });

  it('forwards backend failure verbatim', async () => {
    backendFake.archiveSave.mockResolvedValue({ success: false, error: 'boom' });
    expect(await dispatch('SQLITE_ARCHIVE_SAVE', { stagingName: 's' })).toEqual({ success: false, error: 'boom' });
  });

  it('maps an empty success to the historical error string', async () => {
    backendFake.archiveStatus.mockResolvedValue({ success: true });
    expect(await dispatch('SQLITE_ARCHIVE_STATUS')).toEqual({ success: false, error: 'Archive status returned no data' });
  });
});
