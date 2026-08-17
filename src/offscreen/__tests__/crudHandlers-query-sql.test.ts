/**
 * crudHandlers-query-sql.test.ts
 * Contract test for handleQuery's WHERE/ORDER BY generation after it moved
 * onto the shared sqliteQueryBuilder (buildWhereClause/buildOrderByClause/
 * buildFtsTagMatchCondition). Confirms every filter still produces the same
 * SQL shape it did with the inline query construction.
 */
import { describe, it, expect, vi } from 'vitest';
import { handleQuery } from '../opfsWorker/crudHandlers.js';
import type { HandlerContext } from '../opfsWorker/handlers.js';

function makeStubEngine() {
  const calls: { sql: string; params: unknown[] }[] = [];
  const engine = {
    exec: vi.fn(async () => undefined),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/SELECT COUNT/i.test(sql)) return [{ c: 0 }];
      return [];
    }),
    queryValue: vi.fn(async () => null),
    close: vi.fn(async () => undefined),
  };
  return { ctx: { engine } as unknown as HandlerContext, calls };
}

function rowQuery(calls: { sql: string; params: unknown[] }[]) {
  return calls.find(c => /^\s*SELECT id, url/.test(c.sql));
}

describe('handleQuery — shared query builder contract', () => {
  it('always excludes soft-deleted rows', async () => {
    const { ctx, calls } = makeStubEngine();
    await handleQuery(ctx, {});
    expect(rowQuery(calls)?.sql).toContain('WHERE is_deleted = 0');
  });

  it('applies dateFrom/dateTo/domain/starred/gistSynced filters', async () => {
    const { ctx, calls } = makeStubEngine();
    await handleQuery(ctx, { dateFrom: 100, dateTo: 200, domain: 'example.com', starred: true, gistSynced: 0 });
    const q = rowQuery(calls);
    expect(q?.sql).toContain('created_at >= ?');
    expect(q?.sql).toContain('created_at <= ?');
    expect(q?.sql).toContain('domain = ?');
    expect(q?.sql).toContain('is_starred = ?');
    expect(q?.sql).toContain('gist_synced = ?');
    expect(q?.params).toEqual([100, 200, 'example.com', 1, 0, 20, 0]);
  });

  it('applies an ids IN (...) filter', async () => {
    const { ctx, calls } = makeStubEngine();
    await handleQuery(ctx, { ids: [1, 2, 3] });
    const q = rowQuery(calls);
    expect(q?.sql).toContain('id IN (?,?,?)');
    expect(q?.params).toEqual([1, 2, 3, 20, 0]);
  });

  it('applies a tag filter via the FTS5 MATCH sub-query, not LIKE', async () => {
    const { ctx, calls } = makeStubEngine();
    await handleQuery(ctx, { tag: 'news' });
    const q = rowQuery(calls);
    expect(q?.sql).toContain('id IN (SELECT rowid FROM browsing_logs_fts WHERE tags MATCH ?)');
    expect(q?.sql).not.toContain('tags LIKE');
    expect(q?.params).toEqual(['"#news"', 20, 0]);
  });

  it('strips FTS5 operators and truncates an overlong tag before matching', async () => {
    const { ctx, calls } = makeStubEngine();
    await handleQuery(ctx, { tag: 'OR "malicious" NEAR' });
    const q = rowQuery(calls);
    expect(q?.params?.[0]).toBe('"#malicious"');
  });

  it('defaults to ORDER BY created_at DESC when unspecified', async () => {
    const { ctx, calls } = makeStubEngine();
    await handleQuery(ctx, {});
    expect(rowQuery(calls)?.sql).toMatch(/ORDER BY created_at DESC/);
  });

  it('orders by an explicit column and direction', async () => {
    const { ctx, calls } = makeStubEngine();
    await handleQuery(ctx, { orderBy: 'title', orderDir: 'ASC' } as never);
    expect(rowQuery(calls)?.sql).toMatch(/ORDER BY title ASC/);
  });

  it('rejects an orderBy column outside the whitelist', async () => {
    const { ctx } = makeStubEngine();
    await expect(handleQuery(ctx, { orderBy: 'sql_injection; DROP TABLE browsing_logs' } as never))
      .rejects.toThrow(/Invalid orderBy/);
  });

  it('combines multiple filters with AND', async () => {
    const { ctx, calls } = makeStubEngine();
    await handleQuery(ctx, { domain: 'example.com', starred: true, tag: 'news' });
    const q = rowQuery(calls);
    expect(q?.sql).toMatch(/WHERE is_deleted = 0 AND domain = \? AND is_starred = \? AND id IN \(SELECT rowid FROM browsing_logs_fts WHERE tags MATCH \?\)/);
  });

  it('respects limit/offset', async () => {
    const { ctx, calls } = makeStubEngine();
    await handleQuery(ctx, { limit: 5, offset: 10 });
    const q = rowQuery(calls);
    expect(q?.params?.slice(-2)).toEqual([5, 10]);
  });
});
