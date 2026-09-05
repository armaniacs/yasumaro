// @vitest-environment jsdom
/**
 * search-sort-parametric.test.ts
 * PBI-34: the three search-sort suites (IdbVfsBackend-search-sort,
 * opfsWorker-search-sort, storageFallback-search-sort) integrated into ONE
 * backend-parameterized suite. Backend is the parameter — cases are defined
 * once, not copied per backend.
 *
 * - idb/opfs (SQL backends): assert the emitted ORDER BY fragment. Both go
 *   through queryPlan.ts shared builders, so identical expectations prove
 *   the unification; the malicious-orderDir row encodes the INTENTIONAL
 *   policy split (idb fails closed, opfs coerces to DESC).
 * - fallback (no FTS5): assert observable row order instead. Default search
 *   keeps insertion order (no rank); explicit created_at sorts. Intentional.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IdbVfsBackend } from '../IdbVfsBackend.js';
import { handleSearchFts, handleSearchLike, __setEngineForTesting } from '../opfsWorker.js';
import { handleAuditLogQuery } from '../opfsWorker/auditHandlers.js';
import { FallbackStorage } from '../storageFallback.js';

type SqlCall = { sql: string; params: unknown[] };

function makeIdb(fts5Available = true) {
  const calls: SqlCall[] = [];
  const engine = {
    fts5Available,
    execWithCache: vi.fn(async (sql: string, params: unknown[] = [], callback?: (row: unknown[]) => void) => {
      calls.push({ sql, params });
      if (callback && /SELECT COUNT|SELECT changes|last_insert_rowid/i.test(sql)) callback([0]);
    }),
  };
  const backend = new IdbVfsBackend(engine as never);
  (backend as unknown as { ensureDb: () => void }).ensureDb = () => {};
  return { backend, calls };
}

function makeOpfsEngine() {
  const calls: SqlCall[] = [];
  const engine = {
    exec: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
    }),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/SELECT COUNT|SELECT changes/i.test(sql)) return [{ c: 0 }];
      return [];
    }),
    queryValue: vi.fn(async () => null),
    close: vi.fn(async () => undefined),
  };
  return { engine, calls };
}

const rowSql = (calls: SqlCall[]) =>
  calls.find((c) => /ORDER BY/i.test(c.sql) && !/COUNT/i.test(c.sql))?.sql ?? '';

async function seedFallback(): Promise<FallbackStorage> {
  const storage = new FallbackStorage();
  await storage.insert({ url: 'https://a.example.com', created_at: 100 });
  await storage.insert({ url: 'https://b.example.com', created_at: 300 });
  await storage.insert({ url: 'https://c.example.com', created_at: 200 });
  return storage;
}

describe('search-sort parametric — FTS ORDER BY (idb vs opfs SQL)', () => {
  beforeEach(() => {
    __setEngineForTesting(null, false);
  });

  const cases = [
    { label: 'default relevance orders by rank', orderBy: undefined, orderDir: undefined, expect: /ORDER BY rank/ },
    { label: 'created_at DESC', orderBy: 'created_at', orderDir: 'DESC', expect: /ORDER BY b\.created_at DESC, b\.id DESC/ },
    { label: 'created_at ASC', orderBy: 'created_at', orderDir: 'ASC', expect: /ORDER BY b\.created_at ASC, b\.id ASC/ },
  ] as const;

  it.each(cases)('$label', async ({ orderBy, orderDir, expect: re }) => {
    const idb = makeIdb(true);
    await idb.backend.query({ text: 'example query text', limit: 20, ...(orderBy ? { orderBy, orderDir } : {}) });
    expect(rowSql(idb.calls)).toMatch(re);

    const opfs = makeOpfsEngine();
    __setEngineForTesting(opfs.engine as never, true);
    await handleSearchFts('"example"', 20, 0, orderBy, orderDir);
    expect(rowSql(opfs.calls)).toMatch(re);
  });
});

describe('search-sort parametric — LIKE fallback ORDER BY (idb vs opfs SQL vs fallback rows)', () => {
  beforeEach(() => {
    __setEngineForTesting(null, false);
  });

  const cases = [
    { label: 'created_at ASC', orderBy: 'created_at', orderDir: 'ASC', sqlExpect: /ORDER BY created_at ASC/, rowsExpect: [100, 200, 300] },
    { label: 'default is created_at DESC', orderBy: undefined, orderDir: undefined, sqlExpect: /ORDER BY created_at DESC/, rowsExpect: null },
  ] as const;

  it.each(cases)('$label', async ({ orderBy, orderDir, sqlExpect, rowsExpect }) => {
    const idb = makeIdb(false);
    await idb.backend.query({ text: 'ai', limit: 20, ...(orderBy ? { orderBy, orderDir } : {}) });
    expect(rowSql(idb.calls)).toMatch(sqlExpect);

    const opfs = makeOpfsEngine();
    __setEngineForTesting(opfs.engine as never, false);
    await handleSearchLike('ai', 20, 0, orderBy, orderDir);
    expect(rowSql(opfs.calls)).toMatch(sqlExpect);

    if (rowsExpect) {
      const storage = await seedFallback();
      const result = await storage.search('example', 10, 0, { orderBy: 'created_at', orderDir: 'ASC' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.rows.map((r) => r.created_at)).toEqual(rowsExpect);
    }
  });

  it('fallback search without orderBy keeps insertion order (no FTS5 rank — intentional)', async () => {
    const storage = await seedFallback();
    const result = await storage.search('example', 10, 0);
    expect(result.success).toBe(true);
    if (result.success) expect(result.rows.map((r) => r.created_at)).toEqual([100, 300, 200]);
  });

  it('fallback explicit created_at DESC sorts newest first', async () => {
    const storage = await seedFallback();
    const result = await storage.search('example', 10, 0, { orderBy: 'created_at', orderDir: 'DESC' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.rows.map((r) => r.created_at)).toEqual([300, 200, 100]);
  });
});

describe('search-sort parametric — invalid orderDir policy split (intentional)', () => {
  beforeEach(() => {
    __setEngineForTesting(null, false);
  });

  const malicious = 'DESC; DROP TABLE browsing_logs; --';

  it('idb fails closed: success:false and no row query issued', async () => {
    const idb = makeIdb(true);
    const result = await idb.backend.query({
      text: 'example query text', limit: 20, orderBy: 'created_at',
      orderDir: malicious as unknown as 'ASC' | 'DESC',
    });
    expect(result.success).toBe(false);
    expect(rowSql(idb.calls)).toBe('');
  });

  it('opfs coerces to DESC without interpolating the payload', async () => {
    const opfs = makeOpfsEngine();
    __setEngineForTesting(opfs.engine as never, true);
    await handleSearchFts('"example"', 20, 0, 'created_at', malicious as unknown as 'ASC' | 'DESC');
    const sql = rowSql(opfs.calls);
    expect(sql).toMatch(/ORDER BY b\.created_at DESC, b\.id DESC/);
    expect(sql).not.toContain('DROP TABLE');

    const opfsLike = makeOpfsEngine();
    __setEngineForTesting(opfsLike.engine as never, false);
    await handleSearchLike('ai', 20, 0, 'created_at', malicious as unknown as 'ASC' | 'DESC');
    const likeSql = rowSql(opfsLike.calls);
    expect(likeSql).toMatch(/ORDER BY created_at DESC/);
    expect(likeSql).not.toContain('DROP TABLE');
  });

  it('fallback fails closed via the shared spec (no interpolation)', async () => {
    const storage = await seedFallback();
    const result = await storage.search('example', 10, 0, {
      orderBy: 'created_at',
      orderDir: malicious as unknown as 'ASC' | 'DESC',
    });
    expect(result.success).toBe(false);
  });
});

describe('search-sort parametric — audit-log LIMIT clamp caps differ (intentional)', () => {
  beforeEach(() => {
    __setEngineForTesting(null, false);
  });

  // idb allows 100000 audit rows, the worker caps at 1000 — preserved gap.
  it.each([
    ['negative', -1, 100, 100],
    ['zero', 0, 100, 100],
    ['non-integer', 0.5, 100, 100],
    ['huge', 1e9, 100000, 1000],
    ['normal', 50, 50, 50],
  ])('limit=%s clamps to idb=%s / opfs=%s in the LIMIT param', async (_label, raw, idbExpected, opfsExpected) => {
    const idb = makeIdb(true);
    await idb.backend.queryAuditLog({ limit: raw as number });
    const idbQuery = idb.calls.find((c) => /FROM audit_log ORDER BY/i.test(c.sql));
    expect(idbQuery?.params[0]).toBe(idbExpected);

    const opfs = makeOpfsEngine();
    __setEngineForTesting(opfs.engine as never, true);
    await handleAuditLogQuery({ engine: opfs.engine as never }, { limit: raw as number, offset: 0 });
    const opfsQuery = opfs.calls.find((c) => /FROM audit_log ORDER BY/i.test(c.sql));
    expect(opfsQuery?.params[0]).toBe(opfsExpected);
  });
});
