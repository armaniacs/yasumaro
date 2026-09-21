// @vitest-environment jsdom
/**
 * opfs-search-skeleton-pin.test.ts
 * PBI 2026-09-21-23 (TDD pin): pins CURRENT search behavior for the FTS and
 * LIKE paths in both backends BEFORE the runCountAndRows skeleton unification.
 * After the refactor these tests must pass UNCHANGED (byte-equal SQL/params,
 * same rows/total). The intentional order-policy divergence (opfs coerce vs
 * idb error) is asserted per backend and must be preserved.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IdbVfsBackend } from '../IdbVfsBackend.js';
import { handleSearchFts, handleSearchLike, __setEngineForTesting } from '../opfsWorker.js';

const NAMED_ROW = {
  id: 7, url: 'https://example.com/a', title: 'Hello', summary: 'sum',
  tags: '#news', created_at: 1700000000000, domain: 'example.com',
  visit_duration: 12, scroll_ratio: 0.5, is_starred: 0, rank: -1.5,
};

function makeOpfsStub(countResult = 2) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const engine = {
    exec: vi.fn(async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); }),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/SELECT COUNT/i.test(sql)) return [{ c: countResult }];
      return [{ ...NAMED_ROW }, { ...NAMED_ROW, id: 8 }];
    }),
    queryValue: vi.fn(async () => null),
    close: vi.fn(async () => undefined),
  };
  __setEngineForTesting(engine as never, true);
  return { engine, calls };
}

// Positional column order = SEARCH_COLUMNS_WITH_RANK.
const POSITIONAL_ROW = [
  7, 'https://example.com/a', 'Hello', 'sum', '#news',
  1700000000000, 'example.com', 12, 0.5, 0, -1.5,
];

function makeIdbStub(fts5Available = true, countResult = 2) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const engine = {
    fts5Available,
    execWithCache: vi.fn(async (sql: string, params: unknown[] = [], callback?: (row: unknown[]) => void) => {
      calls.push({ sql, params });
      if (callback && /SELECT COUNT/i.test(sql)) callback([countResult]);
      if (callback && /ORDER BY/i.test(sql) && !/COUNT/i.test(sql)) {
        callback([...POSITIONAL_ROW]);
        callback([...POSITIONAL_ROW.slice(0, 10), 8, POSITIONAL_ROW[10]]);
      }
    }),
  };
  const backend = new IdbVfsBackend(engine as never);
  (backend as unknown as { ensureDb: () => void }).ensureDb = () => {};
  return { backend, calls };
}

const countSql = (calls: { sql: string }[]) => calls.find((c) => /COUNT\(\*\)/i.test(c.sql))?.sql ?? '';
const rowsSql = (calls: { sql: string }[]) =>
  calls.find((c) => /ORDER BY/i.test(c.sql) && !/COUNT\(\*\)/i.test(c.sql))?.sql ?? '';

describe('skeleton pin: opfsWorker FTS path (text+tag)', () => {
  beforeEach(() => { __setEngineForTesting(null, false); });

  it('emits byte-stable count/rows SQL+params and maps rows via mapNamed', async () => {
    const opfs = makeOpfsStub(2);
    const res = await handleSearchFts('"hello"', 20, 0, 'created_at', 'DESC',
      { text: 'hello', tag: 'news', limit: 20, offset: 0 });
    expect(res.total).toBe(2);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toMatchObject({ id: 7, url: 'https://example.com/a', rank: -1.5 });
    // Pinned shape: FTS JOIN + MATCH + deleted filter + tag condition.
    expect(countSql(opfs.calls)).toContain('browsing_logs_fts MATCH ?');
    expect(countSql(opfs.calls)).toContain('b.is_deleted = 0');
    expect(rowsSql(opfs.calls)).toContain('ORDER BY b.created_at DESC, b.id DESC');
    // Snapshot the full SQL text + params order (byte equality across refactor).
    expect({ sql: countSql(opfs.calls), params: opfs.calls.find((c) => /COUNT\(\*\)/i.test(c.sql))?.params }).toMatchSnapshot();
    expect({ sql: rowsSql(opfs.calls), params: opfs.calls.find((c) => /ORDER BY/i.test(c.sql) && !/COUNT\(\*\)/i.test(c.sql))?.params }).toMatchSnapshot();
  });

  it('preserves coerce policy: invalid orderDir normalizes to DESC instead of failing', async () => {
    makeOpfsStub(0);
    const res = await handleSearchFts('"hello"', 20, 0, 'created_at', 'BOGUS' as never, { text: 'hello' });
    expect(res.total).toBe(0);
  });
});

describe('skeleton pin: opfsWorker LIKE path (text+tag)', () => {
  beforeEach(() => { __setEngineForTesting(null, false); });

  it('emits byte-stable count/rows SQL+params and maps rows via mapNamed', async () => {
    const opfs = makeOpfsStub(2);
    const res = await handleSearchLike('hel', 20, 0, 'created_at', 'DESC',
      { text: 'hel', tag: 'news', limit: 20, offset: 0 });
    expect(res.total).toBe(2);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toMatchObject({ id: 7, rank: -1.5 });
    expect(countSql(opfs.calls)).toContain('url LIKE ?');
    expect(rowsSql(opfs.calls)).toContain('ORDER BY created_at DESC');
    expect({ sql: countSql(opfs.calls), params: opfs.calls.find((c) => /COUNT\(\*\)/i.test(c.sql))?.params }).toMatchSnapshot();
    expect({ sql: rowsSql(opfs.calls), params: opfs.calls.find((c) => /ORDER BY/i.test(c.sql) && !/COUNT\(\*\)/i.test(c.sql))?.params }).toMatchSnapshot();
  });

  it('preserves coerce policy: invalid orderDir normalizes to DESC instead of failing', async () => {
    makeOpfsStub(0);
    const res = await handleSearchLike('hel', 20, 0, 'created_at', 'BOGUS' as never, { text: 'hel' });
    expect(res.total).toBe(0);
  });
});

describe('skeleton pin: IdbVfsBackend search (same input, same rows/counts; error policy stays)', () => {
  it('FTS path returns same rows/counts as opfs for same input', async () => {
    const { backend, calls } = makeIdbStub(true, 2);
    const res = await backend.query({ text: 'hello query text', tag: 'news', limit: 20, offset: 0 });
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.total).toBe(2);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toMatchObject({ id: 7, url: 'https://example.com/a' });
    expect(countSql(calls)).toContain('browsing_logs_fts MATCH ?');
    expect({ sql: countSql(calls), params: calls.find((c) => /COUNT\(\*\)/i.test(c.sql))?.params }).toMatchSnapshot();
    expect({ sql: rowsSql(calls), params: calls.find((c) => /ORDER BY/i.test(c.sql) && !/COUNT\(\*\)/i.test(c.sql))?.params }).toMatchSnapshot();
  });

  it('LIKE path returns same rows/counts as opfs for same input', async () => {
    const { backend, calls } = makeIdbStub(false, 2);
    const res = await backend.query({ text: 'ai', tag: 'news', limit: 20, offset: 0 } as never);
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.total).toBe(2);
    expect(res.rows).toHaveLength(2);
    expect(countSql(calls)).toContain('url LIKE ?');
    expect({ sql: countSql(calls), params: calls.find((c) => /COUNT\(\*\)/i.test(c.sql))?.params }).toMatchSnapshot();
    expect({ sql: rowsSql(calls), params: calls.find((c) => /ORDER BY/i.test(c.sql) && !/COUNT\(\*\)/i.test(c.sql))?.params }).toMatchSnapshot();
  });

  it('preserves error policy: invalid order is an error (not coerce)', async () => {
    const { backend } = makeIdbStub(true, 0);
    const res = await backend.query({ text: 'hello query text', limit: 20, orderBy: 'created_at', orderDir: 'BOGUS' } as never);
    expect(res.success).toBe(false);
  });
});
