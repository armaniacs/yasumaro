// @vitest-environment jsdom
/**
 * search-backend-parity-pin.test.ts
 * PBI 2026-11-08-05 (fixture-first parity pin).
 *
 * The FTS JOIN (`browsing_logs AS b`) needs `b.`-qualified filter columns, but
 * the worker has always emitted them unqualified (history only) while the host
 * qualifies per-path — so the same logical query produced different SQL per
 * backend. This pins the unified contract: identical COUNT/rows SQL bytes +
 * identical params on both backends for the same logical search.
 *
 * The invalid-orderDir split is INTENTIONAL and pinned here (not unified):
 * the host fails closed (untrusted input over chrome.runtime.sendMessage must
 * never reach string interpolation), the worker coerces to DESC (legacy).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IdbVfsBackend } from '../IdbVfsBackend.js';
import { __setEngineForTesting } from '../opfsWorker.js';
import { handleSearch } from '../opfsWorker/searchHandlers.js';

type Call = { sql: string; params: unknown[] };

function makeIdb(fts5Available: boolean, countResult = 1): { backend: IdbVfsBackend; calls: Call[] } {
  const calls: Call[] = [];
  const engine = {
    fts5Available,
    execWithCache: vi.fn(async (sql: string, params: unknown[] = [], callback?: (row: unknown[]) => void) => {
      calls.push({ sql, params });
      if (callback && /SELECT COUNT/i.test(sql)) callback([countResult]);
    }),
  };
  const backend = new IdbVfsBackend(engine as never);
  (backend as unknown as { ensureDb: () => void }).ensureDb = () => {};
  return { backend, calls };
}

function makeOpfs(countResult = 1): { ctx: { engine: unknown }; calls: Call[] } {
  const calls: Call[] = [];
  const engine = {
    exec: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
    }),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/SELECT COUNT/i.test(sql)) return [{ c: countResult }];
      return [];
    }),
    queryValue: vi.fn(async () => null),
    close: vi.fn(async () => undefined),
  };
  __setEngineForTesting(engine as never, true);
  return { ctx: { engine: engine as never }, calls };
}

const countCall = (calls: Call[]) => calls.find((c) => /COUNT\(\*\)/i.test(c.sql))!;
const rowsCall = (calls: Call[]) =>
  calls.find((c) => /ORDER BY/i.test(c.sql) && !/COUNT\(\*\)/i.test(c.sql))!;

describe('search backend parity pin (PBI 2026-11-08-05)', () => {
  beforeEach(() => {
    __setEngineForTesting(null, false);
  });

  it('FTS with a domain filter: byte-identical COUNT/rows SQL+params on both backends', async () => {
    const q = { text: 'runes', domain: 'a.test', limit: 20, offset: 0, orderBy: 'created_at', orderDir: 'DESC' } as const;
    const idb = makeIdb(true);
    await idb.backend.query({ ...q });
    const opfs = makeOpfs();
    await handleSearch(opfs.ctx as never, { ...q }, true);

    expect(rowsCall(opfs.calls).sql).toContain('browsing_logs_fts MATCH ?');
    // The unified contract: the FTS filter rides the JOIN alias on BOTH backends.
    expect(rowsCall(idb.calls).sql).toBe(rowsCall(opfs.calls).sql);
    expect(countCall(idb.calls).sql).toBe(countCall(opfs.calls).sql);
    expect(rowsCall(idb.calls).params).toEqual(rowsCall(opfs.calls).params);
    expect(countCall(idb.calls).params).toEqual(countCall(opfs.calls).params);
  });

  it('FTS with an ids filter: byte-identical COUNT/rows SQL+params on both backends', async () => {
    const q = { text: 'runes', ids: [3, 7] as number[], limit: 10, offset: 0 };
    const idb = makeIdb(true);
    await idb.backend.query({ ...q });
    const opfs = makeOpfs();
    await handleSearch(opfs.ctx as never, { ...q }, true);

    expect(rowsCall(idb.calls).sql).toBe(rowsCall(opfs.calls).sql);
    expect(countCall(idb.calls).sql).toBe(countCall(opfs.calls).sql);
    expect(rowsCall(idb.calls).params).toEqual(rowsCall(opfs.calls).params);
    expect(countCall(idb.calls).params).toEqual(countCall(opfs.calls).params);
  });

  it('LIKE with a domain filter: byte-identical COUNT/rows SQL+params on both backends', async () => {
    const q = { text: 'ru', domain: 'a.test', limit: 20, offset: 0 } as const;
    const idb = makeIdb(false);
    await idb.backend.query({ ...q } as never);
    const opfs = makeOpfs();
    await handleSearch(opfs.ctx as never, { ...q }, true);

    expect(rowsCall(opfs.calls).sql).toContain('url LIKE ?');
    expect(rowsCall(idb.calls).sql).toBe(rowsCall(opfs.calls).sql);
    expect(countCall(idb.calls).sql).toBe(countCall(opfs.calls).sql);
    expect(rowsCall(idb.calls).params).toEqual(rowsCall(opfs.calls).params);
    expect(countCall(idb.calls).params).toEqual(countCall(opfs.calls).params);
  });

  it('INTENTIONAL divergence: invalid orderDir fails closed on the host, coerces on the worker', async () => {
    const malicious = 'DESC; DROP TABLE browsing_logs; --';
    const idb = makeIdb(true);
    const res = await idb.backend.query({
      text: 'runes query text', limit: 20, orderBy: 'created_at',
      orderDir: malicious as unknown as 'ASC' | 'DESC',
    });
    // Host is the trust boundary: fail closed, emit no search SQL.
    expect(res.success).toBe(false);
    expect(idb.calls.filter((c) => /ORDER BY/i.test(c.sql))).toHaveLength(0);

    const opfs = makeOpfs();
    await handleSearch(
      opfs.ctx as never,
      { text: 'runes', orderBy: 'created_at', orderDir: malicious } as never,
      true,
    );
    const sql = rowsCall(opfs.calls).sql;
    expect(sql).toMatch(/ORDER BY b\.created_at DESC, b\.id DESC/);
    expect(sql).not.toContain('DROP TABLE');
  });
});
