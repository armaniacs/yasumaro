import { describe, it, expect } from 'vitest';
import { buildFilterConditions, buildExtraWhereSql, buildFtsSearchStatements, buildLikeSearchStatements, buildQuerySpec } from '../queryPlan.js';
import { QUERY_CAPS } from '../../messaging/limits.js';

describe('buildFilterConditions — shared filter vocabulary (PBI 2026-09-12-27)', () => {
  it('emits one condition per present filter in a stable order', () => {
    const conds = buildFilterConditions({
      dateFrom: 100, dateTo: 200, domain: 'a.com', starred: true,
      gistSynced: 1, ids: [1, 2], excludeDeleted: true,
    });
    expect(conds.map((c) => c.sql.split(' ')[0])).toEqual([
      'is_deleted', 'created_at', 'created_at', 'domain', 'is_starred', 'gist_synced', 'id',
    ]);
    // PBI 2026-09-12-35: params is a flat vector — ids spreads into it (the
    // round-12 version bound the whole array as one value).
    expect(conds.flatMap((c) => c.params)).toEqual([
      100, 200, 'a.com', 1, 1, 1, 2,
    ]);
  });

  it('search+ids flattens ids into the params vector (round-12 nested-bind bug)', () => {
    const extra = buildExtraWhereSql({ text: 'query', ids: [3, 7] } as never, { qualified: true });
    const inCondition = extra.extraWhereSqlFts.match(/id IN \((\?,\?)\)/);
    expect(inCondition).not.toBeNull();
    // Two placeholders, two flat bind values — was one nested [3,7] array.
    expect(extra.extraParams.filter((p) => p === 3 || p === 7)).toEqual([3, 7]);
  });

  it('omits is_deleted when excludeDeleted is explicitly false', () => {
    const conds = buildFilterConditions({ excludeDeleted: false, domain: 'a.com' });
    expect(conds.map((c) => c.sql)).toEqual(['domain = ?']);
  });

  it('keeps is_deleted by default (excludeDeleted undefined)', () => {
    const conds = buildFilterConditions({});
    expect(conds.map((c) => c.sql)).toEqual(['is_deleted = 0']);
  });
});

describe('buildExtraWhereSql — search projection honors excludeDeleted (PBI 2026-09-12-27)', () => {
  it('includes the deleted filter by default', () => {
    const extra = buildExtraWhereSql({ domain: 'a.com' });
    expect(extra.extraWhereSql).toContain('domain = ?');
    expect(extra.includeDeletedFilter).toBe(true);
  });

  it('drops the deleted filter when excludeDeleted is false', () => {
    const extra = buildExtraWhereSql({ domain: 'a.com', excludeDeleted: false });
    expect(extra.extraWhereSql).toContain('domain = ?');
    expect(extra.includeDeletedFilter).toBe(false);
  });

  it('qualifies columns for the FTS path without regex string-rewrite', () => {
    const extra = buildExtraWhereSql({ domain: 'a.com', excludeDeleted: true }, { qualified: true });
    expect(extra.extraWhereSqlFts).toContain('b.domain = ?');
    expect(extra.extraWhereSqlFts).toContain('b.is_deleted = 0');
  });
});

describe('search builders honor excludeDeleted (PBI 2026-09-12-27)', () => {
  it('FTS: includeDeletedFilter false drops b.is_deleted = 0', () => {
    const stmts = buildFtsSearchStatements(
      { extraWhereSql: '', extraWhereSqlFts: '', extraParams: [], includeDeletedFilter: false },
      { ftsQuery: 'test', orderClause: 'rank DESC', limit: 10, offset: 0, tagFilter: null },
    );
    expect(stmts.countSql).not.toContain('b.is_deleted = 0');
    expect(stmts.rowsSql).not.toContain('b.is_deleted = 0');
  });

  it('FTS: includeDeletedFilter true keeps b.is_deleted = 0', () => {
    const stmts = buildFtsSearchStatements(
      { extraWhereSql: '', extraWhereSqlFts: '', extraParams: [], includeDeletedFilter: true },
      { ftsQuery: 'test', orderClause: 'rank DESC', limit: 10, offset: 0, tagFilter: null },
    );
    expect(stmts.countSql).toContain('b.is_deleted = 0');
  });

  it('LIKE: includeDeletedFilter false drops is_deleted = 0', () => {
    const stmts = buildLikeSearchStatements(
      { extraWhereSql: '', extraWhereSqlFts: '', extraParams: [], includeDeletedFilter: false },
      { likePattern: '%test%', orderClause: 'created_at DESC', limit: 10, offset: 0, tagFilter: null },
    );
    expect(stmts.countSql).not.toContain('is_deleted = 0');
  });

  it('LIKE: includeDeletedFilter true keeps is_deleted = 0', () => {
    const stmts = buildLikeSearchStatements(
      { extraWhereSql: '', extraWhereSqlFts: '', extraParams: [], includeDeletedFilter: true },
      { likePattern: '%test%', orderClause: 'created_at DESC', limit: 10, offset: 0, tagFilter: null },
    );
    expect(stmts.countSql).toContain('is_deleted = 0');
  });
});

describe('plain path — buildQuerySpec parity (PBI 2026-09-12-27)', () => {
  it('plain listing keeps the deleted filter by default', () => {
    const spec = buildQuerySpec({ limit: 10 }, { caps: QUERY_CAPS, fts5Available: false });
    expect(spec.where).toContain('is_deleted = 0');
  });

  it('plain listing drops the deleted filter when excludeDeleted is false', () => {
    const spec = buildQuerySpec({ limit: 10, excludeDeleted: false }, { caps: QUERY_CAPS, fts5Available: false });
    expect(spec.where).not.toContain('is_deleted = 0');
  });
});
