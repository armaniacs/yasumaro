// @vitest-environment jsdom
/**
 * auditLogRetention.test.ts — PBI 2026-09-29-31
 *
 * Two properties of the audit_log retention seam, both previously false:
 *   1. the trail had no deletion path at all (unbounded privacy record), and
 *   2. clear_all skipped the table, so a user asking to erase their history
 *      left the send trail behind.
 *
 * The sweep runs through the same purge seam as the record/content purges, on
 * both storage backends, and the tests below pin the *same* SQL on each — a
 * per-backend re-spelling of the delete would let one path drift into a
 * no-op while the other still purges.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IdbVfsBackend } from '../IdbVfsBackend.js';
import { handleAuditLogPurge, handleClearAll } from '../opfsWorker/purgeHandlers.js';
import { __setEngineForTesting } from '../opfsWorker.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function makeIdbStub(changesResult = 0) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const engine = {
    fts5Available: true,
    execWithCache: vi.fn(async (sql: string, params: unknown[] = [], callback?: (row: unknown[]) => void) => {
      calls.push({ sql, params });
      if (callback && /SELECT changes/i.test(sql)) callback([changesResult]);
    }),
  };
  const backend = new IdbVfsBackend(engine as never);
  (backend as unknown as { ensureDb: () => void }).ensureDb = () => {};
  return { backend, calls };
}

function makeOpfsStub(changesResult = 0) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const engine = {
    exec: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
    }),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/SELECT changes/i.test(sql)) return [{ c: changesResult }];
      return [];
    }),
    queryValue: vi.fn(async () => null),
    close: vi.fn(async () => undefined),
  };
  __setEngineForTesting(engine as never, true);
  return { engine, calls };
}

const auditDelete = (calls: { sql: string; params: unknown[] }[]) =>
  calls.find((c) => /FROM audit_log WHERE/i.test(c.sql));
const sqlOf = (calls: { sql: string }[]) => calls.map((c) => c.sql);
const paramsOf = (calls: { sql: string }[], re: RegExp) =>
  calls.find((c) => re.test(c.sql))?.params;

describe('audit_log retention sweep: the same DELETE on both backends', () => {
  beforeEach(() => {
    __setEngineForTesting(null, false);
  });

  it('idb and opfs issue the identical age-filtered DELETE with the identical cutoff', async () => {
    // Date-only fake: both backends derive the cutoff from a fresh Date.now(),
    // so without a pinned clock the two parameters differ by a millisecond and
    // the comparison measures the wall clock instead of the SQL.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-29T00:00:00Z'));
    try {
      const idb = makeIdbStub();
      await idb.backend.purgeAuditLog(7);
      const opfs = makeOpfsStub();
      await handleAuditLogPurge({ engine: opfs.engine as never }, { retentionDays: 7 });

      const idbDelete = auditDelete(idb.calls);
      const opfsDelete = auditDelete(opfs.calls);
      expect(idbDelete).toBeDefined();
      expect(opfsDelete).toBeDefined();
      expect(opfsDelete?.sql).toBe(idbDelete?.sql);
      expect(opfsDelete?.params).toEqual(idbDelete?.params);
    } finally {
      vi.useRealTimers();
    }
  });

  it('filters on created_at without a schema column added for expiry', async () => {
    const idb = makeIdbStub();
    await idb.backend.purgeAuditLog(30);

    expect(auditDelete(idb.calls)?.sql).toBe('DELETE FROM audit_log WHERE created_at < ?');
  });

  it('the cutoff is one retention window before now, not now itself', async () => {
    const before = Date.now();
    const idb = makeIdbStub();
    await idb.backend.purgeAuditLog(7);
    const after = Date.now();

    const cutoff = paramsOf(idb.calls, /FROM audit_log WHERE/i)?.[0] as number;
    expect(cutoff).toBeGreaterThanOrEqual(before - 7 * DAY_MS);
    expect(cutoff).toBeLessThanOrEqual(after - 7 * DAY_MS);
  });

  it('both backends report the deleted row count from changes()', async () => {
    const idb = makeIdbStub(4);
    const opfs = makeOpfsStub(4);

    await expect(idb.backend.purgeAuditLog(7)).resolves.toEqual({ success: true, purged: 4 });
    await expect(handleAuditLogPurge({ engine: opfs.engine as never }, { retentionDays: 7 })).resolves.toEqual({ purged: 4 });
  });

  it.each([
    ['undefined window', undefined],
    ['zero window', 0],
    ['negative window', -1],
  ])('%s purges nothing and touches no statement', async (_label, retentionDays) => {
    const idb = makeIdbStub();
    await expect(idb.backend.purgeAuditLog(retentionDays)).resolves.toEqual({ success: true, purged: 0 });
    expect(sqlOf(idb.calls).filter((sql) => /audit_log/i.test(sql))).toEqual([]);

    const opfs = makeOpfsStub();
    await expect(handleAuditLogPurge({ engine: opfs.engine as never }, { retentionDays })).resolves.toEqual({ purged: 0 });
    expect(sqlOf(opfs.calls).filter((sql) => /audit_log/i.test(sql))).toEqual([]);
  });
});

describe('clear_all: audit_log is erased on both backends', () => {
  beforeEach(() => {
    __setEngineForTesting(null, false);
  });

  it('idb clearAll deletes the trail alongside the browsing history', async () => {
    const idb = makeIdbStub();
    await idb.backend.clearAll();

    const cleared = sqlOf(idb.calls).filter((sql) => /^DELETE FROM /i.test(sql));
    expect(cleared).toContain('DELETE FROM browsing_logs');
    expect(cleared).toContain('DELETE FROM audit_log');
  });

  it('opfs handleClearAll deletes the trail alongside the browsing history', async () => {
    const opfs = makeOpfsStub();
    await handleClearAll({ engine: opfs.engine as never }, true);

    const cleared = sqlOf(opfs.calls).filter((sql) => /^DELETE FROM /i.test(sql));
    expect(cleared).toContain('DELETE FROM browsing_logs');
    expect(cleared).toContain('DELETE FROM audit_log');
  });
});
