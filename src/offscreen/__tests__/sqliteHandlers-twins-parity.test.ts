// @vitest-environment jsdom
/**
 * sqliteHandlers-twins-parity.test.ts
 * PBI 2026-09-18-08: pins byte-identical fail-closed behavior of the purge
 * twins and the response shapes of the id/query twins before consolidation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SqliteMessage } from '../../messaging/sqliteMessages.js';

const recordsRepoMock = vi.hoisted(() => ({
  query: vi.fn().mockResolvedValue({ success: true, rows: [], total: 0 }),
  hardDelete: vi.fn().mockResolvedValue({ success: true }),
  toggleStar: vi.fn().mockResolvedValue({ success: true, is_starred: 1 }),
}));

const dbMaintenanceMock = vi.hoisted(() => ({
  purgeOldRecords: vi.fn().mockResolvedValue({ success: true, purged: 3 }),
  purgeContent: vi.fn().mockResolvedValue({ success: true, purged: 2 }),
}));

vi.mock('../recordsRepo.js', () => ({
  insert: vi.fn().mockResolvedValue({ success: true, id: 1 }),
  insertBatch: vi.fn().mockResolvedValue({ success: true, count: 2 }),
  query: recordsRepoMock.query,
  update: vi.fn().mockResolvedValue({ success: true }),
  hardDelete: recordsRepoMock.hardDelete,
  toggleStar: recordsRepoMock.toggleStar,
  getCount: vi.fn().mockResolvedValue({ success: true, count: 5 }),
  getStatus: vi.fn().mockResolvedValue({ success: true }),
  serialize: vi.fn().mockResolvedValue({ success: true, data: new Uint8Array([1]) }),
  clearAll: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../dbMaintenance.js', () => ({
  sqliteHealthCheck: vi.fn().mockResolvedValue(true),
  backupDb: vi.fn().mockResolvedValue({ success: true, data: new Uint8Array([9]) }),
  restoreDb: vi.fn().mockResolvedValue({ success: true }),
  purgeOldRecords: dbMaintenanceMock.purgeOldRecords,
  purgeContent: dbMaintenanceMock.purgeContent,
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

describe('sqlite handler twins parity (PBI 08)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fail-closes identically on garbage numbers for both purge ops', async () => {
    const a = await callHandler('SQLITE_PURGE', { retentionDays: Number('abc') });
    const b = await callHandler('CONTENT_PURGE', { retentionDays: Number('abc') });
    expect(a).toEqual(b);
    expect(a).toEqual(expect.objectContaining({ success: false }));
    expect(dbMaintenanceMock.purgeOldRecords).not.toHaveBeenCalled();
    expect(dbMaintenanceMock.purgeContent).not.toHaveBeenCalled();
  });

  it('keeps id-handler response shapes', async () => {
    const del = await callHandler('SQLITE_DELETE', { id: 7 });
    const star = await callHandler('SQLITE_TOGGLE_STAR', { id: 7 });
    expect(recordsRepoMock.hardDelete).toHaveBeenCalledWith(7);
    expect(recordsRepoMock.toggleStar).toHaveBeenCalledWith(7);
    expect(del).toEqual({ success: true });
    expect(star).toEqual({ success: true, is_starred: 1 });
  });

  it('keeps query/search response shapes', async () => {
    const q = await callHandler('SQLITE_QUERY', {});
    const s = await callHandler('SQLITE_SEARCH', { query: 'hello' });
    expect(recordsRepoMock.query).toHaveBeenCalledTimes(2);
    expect(q).toEqual({ success: true, rows: [], total: 0 });
    expect(s).toEqual({ success: true, rows: [], total: 0 });
  });
});
