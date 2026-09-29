// @vitest-environment jsdom
/**
 * auditLogPurgeSeam.test.ts — PBI 2026-09-29-31
 *
 * The wire + backend half of the audit_log retention seam (the SQL half lives
 * in auditLogRetention.test.ts). What is pinned here:
 *   - the offscreen handler is reachable, is a purge, and fails closed on a
 *     garbage window exactly like its two siblings;
 *   - each StorageBackend implementation answers it, or refuses with a reason
 *     (the JSON fallback keeps no audit_log at all).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SqliteMessage } from '../../messaging/sqliteMessages.js';
import { AUDIT_LOG_UNSUPPORTED_ERROR } from '../StorageBackend.js';

const auditLogRepoMock = vi.hoisted(() => ({
  insertAuditLog: vi.fn().mockResolvedValue({ success: true, id: 1 }),
  queryAuditLog: vi.fn().mockResolvedValue({ success: true, rows: [], total: 0 }),
  purgeAuditLog: vi.fn().mockResolvedValue({ success: true, purged: 2 }),
}));

vi.mock('../auditLogRepo.js', () => ({
  insertAuditLog: auditLogRepoMock.insertAuditLog,
  queryAuditLog: auditLogRepoMock.queryAuditLog,
  purgeAuditLog: auditLogRepoMock.purgeAuditLog,
}));

import { sqliteMessageHandlers } from '../sqliteMessageHandlers.js';
import { OpfsWorkerBackend } from '../OpfsWorkerBackend.js';
import { FallbackStorageAdapter } from '../FallbackStorageAdapter.js';
import { FallbackStorage } from '../storageFallback.js';
import { NoopBackend } from '../StorageBackend.js';

async function callHandler(type: string, payload?: unknown): Promise<unknown> {
  const handler = sqliteMessageHandlers.get(type as never);
  if (!handler) throw new Error(`No handler for ${type}`);
  const msg = { type, payload, traceId: 'trace-1' } as SqliteMessage;
  let response: unknown;
  await handler(msg, (r) => { response = r; });
  return response;
}

describe('SQLITE_AUDIT_LOG_PURGE handler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('routes a valid window to the repo and echoes the purged count', async () => {
    auditLogRepoMock.purgeAuditLog.mockResolvedValue({ success: true, purged: 5 });

    const res = await callHandler('SQLITE_AUDIT_LOG_PURGE', { retentionDays: 7 });

    expect(auditLogRepoMock.purgeAuditLog).toHaveBeenCalledWith(7);
    expect(res).toEqual({ success: true, purged: 5 });
  });

  it('applies the retention default when the payload carries no window', async () => {
    await callHandler('SQLITE_AUDIT_LOG_PURGE');

    expect(auditLogRepoMock.purgeAuditLog).toHaveBeenCalledWith(expect.any(Number));
  });

  // NaN would make purgeCutoffMs NaN, deleting nothing while reporting
  // "0 purged" — the same silent-retention-failure the sibling purges
  // already guard against at this seam.
  it.each([
    ['NaN', Number('abc')],
    ['negative', -1],
    ['fractional', 0.5],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('fails closed on a %s window without reaching the repo', async (_label, retentionDays) => {
    const res = await callHandler('SQLITE_AUDIT_LOG_PURGE', { retentionDays }) as { success: boolean };

    expect(res.success).toBe(false);
    expect(auditLogRepoMock.purgeAuditLog).not.toHaveBeenCalled();
  });
});

describe('StorageBackend implementations answer the audit purge', () => {
  it('opfs worker backend sends AUDIT_LOG_PURGE and projects the count', async () => {
    const tryOpfsProxy = vi.fn().mockResolvedValue({ purged: 8 });
    const backend = new OpfsWorkerBackend({ tryOpfsProxy } as never);

    await expect(backend.purgeAuditLog(7)).resolves.toEqual({ success: true, purged: 8 });
    expect(tryOpfsProxy).toHaveBeenCalledWith('AUDIT_LOG_PURGE', { retentionDays: 7 });
  });

  it('opfs worker backend reports failure (not 0) when the worker is gone', async () => {
    const backend = new OpfsWorkerBackend({ tryOpfsProxy: vi.fn().mockResolvedValue(null) } as never);

    const res = await backend.purgeAuditLog(7);

    expect(res.success).toBe(false);
    expect(res).not.toHaveProperty('purged');
  });

  it('the JSON fallback refuses with the audit-unsupported reason, not a fake 0', async () => {
    const backend = new FallbackStorageAdapter(new FallbackStorage());

    await expect(backend.purgeAuditLog(7)).resolves.toEqual({
      success: false,
      error: AUDIT_LOG_UNSUPPORTED_ERROR,
    });
  });

  it('the no-op backend reports uninitialized', async () => {
    await expect(new NoopBackend().purgeAuditLog(7)).resolves.toEqual({
      success: false,
      error: 'Database not initialized',
    });
  });
});
