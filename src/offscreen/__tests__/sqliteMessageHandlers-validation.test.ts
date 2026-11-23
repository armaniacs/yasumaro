/**
 * sqliteMessageHandlers-validation.test.ts (PBI 2026-11-08-06)
 *
 * The insert/insertBatch/update runners used to coerce-and-forward every
 * value, so CHECK-violating numbers failed the backend write (and a null row
 * or non-array records value threw without ever responding). The runners now
 * fail closed with a named error and leave the repo untouched, while every
 * pinned pass-through shape (empty payload, []/undefined records, numeric
 * string ids) still forwards.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SqliteMessage } from '../../messaging/sqliteMessages.js';

const recordsRepoMock = vi.hoisted(() => ({
  insert: vi.fn().mockResolvedValue({ success: true, id: 1 }),
  insertBatch: vi.fn().mockResolvedValue({ success: true, count: 1, skipped: 0 }),
  query: vi.fn().mockResolvedValue({ success: true, rows: [], total: 0 }),
  update: vi.fn().mockResolvedValue({ success: true }),
  hardDelete: vi.fn().mockResolvedValue({ success: true }),
  toggleStar: vi.fn().mockResolvedValue({ success: true, is_starred: 1 }),
  getCount: vi.fn().mockResolvedValue({ success: true, count: 5 }),
  getStatus: vi.fn().mockResolvedValue({ success: true, initialized: true, path: 'test.db', fallback: false, fts5: true }),
  clearAll: vi.fn().mockResolvedValue({ success: true }),
}));

const dbMaintenanceMock = vi.hoisted(() => ({
  sqliteHealthCheck: vi.fn().mockResolvedValue(true),
  backupDb: vi.fn().mockResolvedValue({ success: true, data: new Uint8Array([9, 9]) }),
  restoreDb: vi.fn().mockResolvedValue({ success: true }),
  purgeOldRecords: vi.fn().mockResolvedValue({ success: true, purged: 3 }),
  purgeContent: vi.fn().mockResolvedValue({ success: true, purged: 2 }),
}));

const auditLogRepoMock = vi.hoisted(() => ({
  insertAuditLog: vi.fn().mockResolvedValue({ success: true, id: 42 }),
  queryAuditLog: vi.fn().mockResolvedValue({ success: true, rows: [], total: 0 }),
  purgeAuditLog: vi.fn().mockResolvedValue({ success: true, purged: 4 }),
}));

vi.mock('../sqliteEngineHost.js', () => ({
  engine: { init: vi.fn().mockResolvedValue(true) },
}));

vi.mock('../recordsRepo.js', () => ({
  insert: recordsRepoMock.insert,
  insertBatch: recordsRepoMock.insertBatch,
  query: recordsRepoMock.query,
  update: recordsRepoMock.update,
  hardDelete: recordsRepoMock.hardDelete,
  toggleStar: recordsRepoMock.toggleStar,
  getCount: recordsRepoMock.getCount,
  getStatus: recordsRepoMock.getStatus,
  clearAll: recordsRepoMock.clearAll,
}));

vi.mock('../dbMaintenance.js', () => ({
  sqliteHealthCheck: dbMaintenanceMock.sqliteHealthCheck,
  backupDb: dbMaintenanceMock.backupDb,
  restoreDb: dbMaintenanceMock.restoreDb,
  purgeOldRecords: dbMaintenanceMock.purgeOldRecords,
  purgeContent: dbMaintenanceMock.purgeContent,
}));

vi.mock('../auditLogRepo.js', () => ({
  insertAuditLog: auditLogRepoMock.insertAuditLog,
  queryAuditLog: auditLogRepoMock.queryAuditLog,
  purgeAuditLog: auditLogRepoMock.purgeAuditLog,
}));

import { sqliteMessageHandlers } from '../sqliteMessageHandlers.js';

async function callHandler(type: string, payload?: unknown): Promise<unknown> {
  const handler = sqliteMessageHandlers.get(type as never);
  if (!handler) throw new Error(`No handler for ${type}`);
  const msg = { type, payload, traceId: 'trace-1' } as SqliteMessage;
  let response: unknown;
  await handler(msg, (r) => { response = r; });
  return response;
}

describe('sqliteMessageHandlers — final-defense validation', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('insert', () => {
    it('rejects a url-less record without calling the repo', async () => {
      const res = await callHandler('SQLITE_INSERT', { title: 'No URL', created_at: 1 });
      expect(res).toEqual({ success: false, error: expect.stringContaining('url') });
      expect(recordsRepoMock.insert).not.toHaveBeenCalled();
    });

    it('rejects an empty-string url without calling the repo', async () => {
      const res = await callHandler('SQLITE_INSERT', { url: '', created_at: 1 });
      expect(res).toEqual({ success: false, error: expect.stringContaining('url') });
      expect(recordsRepoMock.insert).not.toHaveBeenCalled();
    });

    it('rejects a CHECK-violating flag without calling the repo', async () => {
      const res = await callHandler('SQLITE_INSERT', { url: 'https://a.com', created_at: 1, is_starred: 2 });
      expect(res).toEqual({ success: false, error: expect.stringContaining('is_starred') });
      expect(recordsRepoMock.insert).not.toHaveBeenCalled();
    });

    it('rejects an out-of-range scroll_ratio without calling the repo', async () => {
      const res = await callHandler('SQLITE_INSERT', { url: 'https://a.com', created_at: 1, scroll_ratio: 5 });
      expect(res).toEqual({ success: false, error: expect.stringContaining('scroll_ratio') });
      expect(recordsRepoMock.insert).not.toHaveBeenCalled();
    });

    it('still forwards a valid record to the repo', async () => {
      const res = await callHandler('SQLITE_INSERT', { url: 'https://a.com', created_at: 1, title: 't' });
      expect(recordsRepoMock.insert).toHaveBeenCalledTimes(1);
      expect(res).toEqual({ success: true, id: 1 });
    });
  });

  describe('insertBatch', () => {
    it('rejects the batch at the first invalid row without calling the repo', async () => {
      // url presence is enforced by the envelope/handler/wire gates above
      // (this layer must keep forwarding the pinned `{}`/empty shapes), so
      // the final defense rejects the CHECK-violating flag here.
      const res = await callHandler('SQLITE_INSERT_BATCH', {
        records: [
          { url: 'https://a.com', created_at: 1 },
          { url: 'https://b.com', created_at: 2, is_starred: 2 },
        ],
      });
      expect(res).toEqual({ success: false, error: expect.stringContaining('record 1') });
      expect(recordsRepoMock.insertBatch).not.toHaveBeenCalled();
    });

    it('rejects a non-array records value without calling the repo', async () => {
      const res = await callHandler('SQLITE_INSERT_BATCH', { records: 'nope' });
      expect(res).toEqual({ success: false, error: expect.stringContaining('array') });
      expect(recordsRepoMock.insertBatch).not.toHaveBeenCalled();
    });

    it('still forwards a valid batch to the repo', async () => {
      const res = await callHandler('SQLITE_INSERT_BATCH', {
        records: [{ url: 'https://a.com', created_at: 1 }],
      });
      expect(recordsRepoMock.insertBatch).toHaveBeenCalledTimes(1);
      expect(res).toEqual({ success: true, count: 1, skipped: 0 });
    });
  });

  describe('update', () => {
    it('rejects a non-positive id without calling the repo', async () => {
      const res = await callHandler('SQLITE_UPDATE', { id: 0, title: 't' });
      expect(res).toEqual({ success: false, error: expect.stringContaining('positive integer id') });
      expect(recordsRepoMock.update).not.toHaveBeenCalled();
    });

    it('rejects a non-numeric id without calling the repo', async () => {
      const res = await callHandler('SQLITE_UPDATE', { id: 'abc', title: 't' });
      expect(res).toEqual({ success: false, error: expect.stringContaining('positive integer id') });
      expect(recordsRepoMock.update).not.toHaveBeenCalled();
    });

    it('still forwards a valid id with whitelisted keys', async () => {
      const res = await callHandler('SQLITE_UPDATE', { id: 10, title: 'new' });
      expect(recordsRepoMock.update).toHaveBeenCalledWith(10, { title: 'new' });
      expect(res).toEqual({ success: true });
    });
  });
});
