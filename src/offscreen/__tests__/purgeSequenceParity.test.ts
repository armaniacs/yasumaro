// @vitest-environment jsdom
/**
 * purgeSequenceParity.test.ts — PBI 2026-10-09-04 (NN04)
 *
 * Backend-layer parity/golden pin for the purge transaction skeleton. The
 * existing sqliteHandlers-twins-parity.test.ts drives the message-handler
 * layer through a dbMaintenance mock and never sees the SQL the two backends
 * actually emit. This suite drives IdbVfsBackend and opfsWorker/purgeHandlers
 * over recording stub engines and pins, for BOTH backends and BOTH ops:
 *   - the exact statement sequence
 *     (delete-old gate → SELECT changes() → COUNT → excess delete → SELECT
 *     changes()) wrapped in ONE transaction;
 *   - the changes()-based counting rule;
 *   - the retention / maxRecords skip guards (and the count-policy difference
 *     the two ops have always had);
 *   - the audit twin's simplified shape (delete + one changes(), no cap, no
 *     transaction when the window is absent).
 *
 * Written and confirmed green BEFORE the runPurgeSequence consolidation, then
 * re-run after it: a control-flow divergence in either lang fails here. The
 * two stub engines differ only in their scalar-read shape (IDB positional
 * callback vs OPFS named `row.c`), exactly like the production engines — the
 * normalized sequence below is what the shared runner must reproduce.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IdbVfsBackend } from '../IdbVfsBackend.js';
import {
  handlePurgeOldRecords, handleContentPurge, handleAuditLogPurge,
} from '../opfsWorker/purgeHandlers.js';
import type { HandlerContext } from '../opfsWorker/handlers.js';
import { purgeCutoffMs } from '../queryPlan.js';

interface Call { sql: string; params: unknown[] }

/** Positional-reader engine: the IDB backend reads COUNT/changes from row[0]. */
function makeIdbStub(count = 0, changes: number[] = [0]) {
  const calls: Call[] = [];
  let changesIdx = 0;
  const engine = {
    fts5Available: true,
    execWithCache: vi.fn(async (
      sql: string, params: unknown[] = [], callback?: (row: unknown[]) => void,
    ) => {
      calls.push({ sql, params });
      if (!callback) return;
      if (/SELECT changes/i.test(sql)) {
        callback([changes[Math.min(changesIdx, changes.length - 1)]]);
        changesIdx += 1;
      } else if (/SELECT COUNT/i.test(sql)) {
        callback([count]);
      }
    }),
  };
  const backend = new IdbVfsBackend(engine as never);
  (backend as unknown as { ensureDb: () => void }).ensureDb = () => {};
  return { backend, calls };
}

/** Named-row engine: the worker reads COUNT/changes from row.c. */
function makeOpfsStub(count = 0, changes: number[] = [0]) {
  const calls: Call[] = [];
  let changesIdx = 0;
  const engine = {
    exec: vi.fn(async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); }),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/SELECT changes/i.test(sql)) {
        const c = changes[Math.min(changesIdx, changes.length - 1)];
        changesIdx += 1;
        return [{ c }];
      }
      if (/SELECT COUNT/i.test(sql)) return [{ c: count }];
      return [];
    }),
    queryValue: vi.fn(async () => null),
    close: vi.fn(async () => undefined),
  };
  return { engine, calls };
}

const ctxOf = (s: ReturnType<typeof makeOpfsStub>): HandlerContext => ({ engine: s.engine as never });

/**
 * The worker spells `SELECT changes() AS c` (named reader) where the IDB
 * backend spells `SELECT changes()` (positional reader) — the one textual
 * difference that is intentional. Normalize it so the sequence comparison
 * measures control flow, not that spelling.
 */
const normalized = (calls: Call[]): string[] =>
  calls.map((c) => c.sql.replace('SELECT changes() AS c', 'SELECT changes()'));

const paramsFor = (calls: Call[], re: RegExp): unknown[] | undefined =>
  calls.find((c) => re.test(c.sql))?.params;

const FIXED_NOW = Date.parse('2026-10-09T00:00:00Z');

describe('purge sequence parity at the backend layer (NN04 pin)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('purgeOldRecords / handlePurgeOldRecords', () => {
    it('records the identical gated sequence and count for the same input', async () => {
      const idb = makeIdbStub(1005, [4, 3]);
      const opfs = makeOpfsStub(1005, [4, 3]);

      const idbRes = await idb.backend.purgeOldRecords(30, 1000);
      const opfsRes = await handlePurgeOldRecords(ctxOf(opfs), { retentionDays: 30, maxRecords: 1000 }, { postLog: () => {} });

      expect(idbRes).toEqual({ success: true, purged: 7 });
      expect(opfsRes).toEqual({ purged: 7 });

      const expected = [
        'BEGIN IMMEDIATE',
        'DELETE FROM browsing_logs WHERE created_at < ? AND is_starred = 0 AND is_deleted = 0',
        'SELECT changes()',
        'SELECT COUNT(*) AS c FROM browsing_logs WHERE is_deleted = 0',
        'DELETE FROM browsing_logs WHERE id IN (SELECT id FROM browsing_logs WHERE is_starred = 0 AND is_deleted = 0 ORDER BY created_at ASC LIMIT ?)',
        'SELECT changes()',
        'COMMIT',
      ];
      expect(normalized(idb.calls)).toEqual(expected);
      expect(normalized(opfs.calls)).toEqual(expected);

      // Gate binds the retention cutoff; the excess delete binds count - max.
      expect(paramsFor(idb.calls, /DELETE FROM browsing_logs WHERE created_at </)).toEqual([purgeCutoffMs(30, FIXED_NOW)]);
      expect(paramsFor(opfs.calls, /DELETE FROM browsing_logs WHERE created_at </)).toEqual([purgeCutoffMs(30, FIXED_NOW)]);
      expect(paramsFor(idb.calls, /ORDER BY created_at ASC LIMIT/)).toEqual([5]);
      expect(paramsFor(opfs.calls, /ORDER BY created_at ASC LIMIT/)).toEqual([5]);
    });

    it('skips the retention delete for an absent/zero window but still COUNTs (countPolicy=always)', async () => {
      for (const window of [undefined, 0]) {
        const idb = makeIdbStub(100, [0]);
        const opfs = makeOpfsStub(100, [0]);

        await expect(idb.backend.purgeOldRecords(window, undefined)).resolves.toEqual({ success: true, purged: 0 });
        const retentionPayload = window === undefined ? {} : { retentionDays: window };
        await expect(handlePurgeOldRecords(ctxOf(opfs), retentionPayload, { postLog: () => {} }))
          .resolves.toEqual({ purged: 0 });

        const expected = [
          'BEGIN IMMEDIATE',
          'SELECT COUNT(*) AS c FROM browsing_logs WHERE is_deleted = 0',
          'COMMIT',
        ];
        expect(normalized(idb.calls)).toEqual(expected);
        expect(normalized(opfs.calls)).toEqual(expected);
      }
    });

    it('does not delete the excess when the count is at or below maxRecords', async () => {
      const idb = makeIdbStub(1000, [0]);
      const opfs = makeOpfsStub(1000, [0]);

      await idb.backend.purgeOldRecords(30, 1000);
      await handlePurgeOldRecords(ctxOf(opfs), { retentionDays: 30, maxRecords: 1000 }, { postLog: () => {} });

      const expected = [
        'BEGIN IMMEDIATE',
        'DELETE FROM browsing_logs WHERE created_at < ? AND is_starred = 0 AND is_deleted = 0',
        'SELECT changes()',
        'SELECT COUNT(*) AS c FROM browsing_logs WHERE is_deleted = 0',
        'COMMIT',
      ];
      expect(normalized(idb.calls)).toEqual(expected);
      expect(normalized(opfs.calls)).toEqual(expected);
    });
  });

  describe('purgeContent / handleContentPurge', () => {
    it('records the identical cap-only sequence and count for the same input', async () => {
      const idb = makeIdbStub(10, [7]);
      const opfs = makeOpfsStub(10, [7]);

      const idbRes = await idb.backend.purgeContent(undefined, 3, false);
      const opfsRes = await handleContentPurge(ctxOf(opfs), { maxRecords: 3 });

      expect(idbRes).toEqual({ success: true, purged: 7 });
      expect(opfsRes).toEqual({ purged: 7 });

      const expected = [
        'BEGIN IMMEDIATE',
        'SELECT COUNT(*) AS c FROM browsing_logs WHERE content IS NOT NULL AND is_starred = 0',
        'UPDATE browsing_logs SET content = NULL WHERE id IN (SELECT id FROM browsing_logs WHERE content IS NOT NULL AND is_starred = 0 ORDER BY created_at ASC LIMIT ?)',
        'SELECT changes()',
        'COMMIT',
      ];
      expect(normalized(idb.calls)).toEqual(expected);
      expect(normalized(opfs.calls)).toEqual(expected);
      expect(paramsFor(idb.calls, /ORDER BY created_at ASC LIMIT/)).toEqual([7]);
      expect(paramsFor(opfs.calls, /ORDER BY created_at ASC LIMIT/)).toEqual([7]);
    });

    it('runs age-then-cap in one transaction with the same binds on both', async () => {
      const idb = makeIdbStub(10, [2, 3]);
      const opfs = makeOpfsStub(10, [2, 3]);

      await idb.backend.purgeContent(1, 5, false);
      await handleContentPurge(ctxOf(opfs), { retentionDays: 1, maxRecords: 5 });

      const expected = [
        'BEGIN IMMEDIATE',
        'UPDATE browsing_logs SET content = NULL WHERE content IS NOT NULL AND created_at < ? AND is_starred = 0',
        'SELECT changes()',
        'SELECT COUNT(*) AS c FROM browsing_logs WHERE content IS NOT NULL AND is_starred = 0',
        'UPDATE browsing_logs SET content = NULL WHERE id IN (SELECT id FROM browsing_logs WHERE content IS NOT NULL AND is_starred = 0 ORDER BY created_at ASC LIMIT ?)',
        'SELECT changes()',
        'COMMIT',
      ];
      expect(normalized(idb.calls)).toEqual(expected);
      expect(normalized(opfs.calls)).toEqual(expected);
      expect(paramsFor(idb.calls, /created_at < \? AND is_starred/)).toEqual([purgeCutoffMs(1, FIXED_NOW)]);
      expect(paramsFor(opfs.calls, /created_at < \? AND is_starred/)).toEqual([purgeCutoffMs(1, FIXED_NOW)]);
      expect(paramsFor(idb.calls, /ORDER BY created_at ASC LIMIT/)).toEqual([5]);
      expect(paramsFor(opfs.calls, /ORDER BY created_at ASC LIMIT/)).toEqual([5]);
    });

    it('skips the cap COUNT entirely when maxRecords is absent/zero (countPolicy=when-max-records)', async () => {
      for (const max of [undefined, 0]) {
        const idb = makeIdbStub(10, [0]);
        const opfs = makeOpfsStub(10, [0]);

        await expect(idb.backend.purgeContent(undefined, max, false)).resolves.toEqual({ success: true, purged: 0 });
        const capPayload = max === undefined ? {} : { maxRecords: max };
        await expect(handleContentPurge(ctxOf(opfs), capPayload))
          .resolves.toEqual({ purged: 0 });

        const expected = ['BEGIN IMMEDIATE', 'COMMIT'];
        expect(normalized(idb.calls)).toEqual(expected);
        expect(normalized(opfs.calls)).toEqual(expected);
      }
    });
  });

  describe('purgeAuditLog / handleAuditLogPurge (simplified twin)', () => {
    it('records the same delete + single changes() with no COUNT on both', async () => {
      const idb = makeIdbStub(0, [4]);
      const opfs = makeOpfsStub(0, [4]);

      const idbRes = await idb.backend.purgeAuditLog(7);
      const opfsRes = await handleAuditLogPurge(ctxOf(opfs), { retentionDays: 7 });

      expect(idbRes).toEqual({ success: true, purged: 4 });
      expect(opfsRes).toEqual({ purged: 4 });

      const expected = [
        'BEGIN IMMEDIATE',
        'DELETE FROM audit_log WHERE created_at < ?',
        'SELECT changes()',
        'COMMIT',
      ];
      expect(normalized(idb.calls)).toEqual(expected);
      expect(normalized(opfs.calls)).toEqual(expected);
      expect(paramsFor(idb.calls, /FROM audit_log WHERE/)).toEqual([purgeCutoffMs(7, FIXED_NOW)]);
      expect(paramsFor(opfs.calls, /FROM audit_log WHERE/)).toEqual([purgeCutoffMs(7, FIXED_NOW)]);
      // No cap dimension and no COUNT on the trail.
      expect(normalized(idb.calls).some((s) => /SELECT COUNT/i.test(s))).toBe(false);
      expect(normalized(opfs.calls).some((s) => /SELECT COUNT/i.test(s))).toBe(false);
    });

    it('opens no transaction and touches no statement for an absent/zero window', async () => {
      for (const window of [undefined, 0]) {
        const idb = makeIdbStub(0, [0]);
        const opfs = makeOpfsStub(0, [0]);

        await expect(idb.backend.purgeAuditLog(window)).resolves.toEqual({ success: true, purged: 0 });
        const windowPayload = window === undefined ? {} : { retentionDays: window };
        await expect(handleAuditLogPurge(ctxOf(opfs), windowPayload)).resolves.toEqual({ purged: 0 });

        expect(idb.calls).toEqual([]);
        expect(opfs.calls).toEqual([]);
      }
    });
  });
});
