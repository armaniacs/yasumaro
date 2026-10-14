/**
 * search-statement-twins-equivalence.test.ts (PBI 2026-10-14-04)
 *
 * Pins the EXTERNAL behaviour of the unified search-statement skeleton
 * (assembleSearchStatements) and the unified ORDER builder: FTS/LIKE SQL text
 * + bind order must stay byte-identical to the pre-unification twins, and the
 * only surviving SELECT difference is FTS 12 cols (+rank) vs LIKE 11 cols.
 */
import { describe, it, expect } from 'vitest';
import {
  buildFtsSearchStatements,
  buildLikeSearchStatements,
  buildSearchOrderClause,
  buildExtraWhereSql,
  FTS_SEARCH_SELECT_COLUMNS,
  LIKE_SEARCH_SELECT_COLUMNS,
} from '../queryPlan.js';
import {
  buildOrderByClause,
  buildFts5OrderClause,
  buildLikeOrderClause,
} from '../sqliteQueryBuilder.js';
import type { StorageQuery } from '../../utils/sqlite-types.js';

function invalidQuery(extra: Record<string, string>): StorageQuery {
  return extra as unknown as StorageQuery;
}

describe('search-statement twins equivalence (unified skeleton)', () => {
  it('FTS statements keep the exact COUNT/rows text and bind order', () => {
    // Caller-realistic: the FTS path receives a b.-qualified extra
    // (searchExecution per-path qualification). NOTE: both the builder's
    // deletedCond and the qualified extra carry `b.is_deleted = 0`, so the
    // filter textually repeats — a harmless pre-existing tautology, pinned
    // here to prove the unification changed nothing.
    const extra = buildExtraWhereSql({ domain: 'example.com' }, { qualified: true });
    const stmts = buildFtsSearchStatements(extra, {
      ftsQuery: '"hello"',
      orderClause: 'rank',
      limit: 10,
      offset: 5,
    });
    expect(stmts.countSql).toBe(
      'SELECT COUNT(*) AS c FROM browsing_logs_fts ' +
        'JOIN browsing_logs b ON browsing_logs_fts.rowid = b.id ' +
        'WHERE browsing_logs_fts MATCH ? AND b.is_deleted = 0 AND b.is_deleted = 0 AND b.domain = ?',
    );
    expect(stmts.rowsSql).toBe(
      `SELECT ${FTS_SEARCH_SELECT_COLUMNS} FROM browsing_logs_fts ` +
        'JOIN browsing_logs b ON browsing_logs_fts.rowid = b.id ' +
        'WHERE browsing_logs_fts MATCH ? AND b.is_deleted = 0 AND b.is_deleted = 0 AND b.domain = ? ' +
        'ORDER BY rank LIMIT ? OFFSET ?',
    );
    expect(stmts.countParams).toEqual(['"hello"', 'example.com']);
    expect(stmts.rowsParams).toEqual(['"hello"', 'example.com', 10, 5]);
  });

  it('LIKE statements keep the exact COUNT/rows text and bind order', () => {
    // Same note as FTS: the unqualified extra also carries `is_deleted = 0`,
    // so it textually repeats after the LIKE base condition (pre-existing).
    const extra = buildExtraWhereSql({ domain: 'example.com' });
    const stmts = buildLikeSearchStatements(extra, {
      likePattern: '%hello%',
      orderClause: 'created_at DESC',
      limit: 20,
      offset: 0,
    });
    expect(stmts.countSql).toBe(
      'SELECT COUNT(*) AS c FROM browsing_logs ' +
        'WHERE is_deleted = 0 AND (url LIKE ? OR title LIKE ? OR summary LIKE ? OR tags LIKE ?) ' +
        'AND is_deleted = 0 AND domain = ?',
    );
    expect(stmts.rowsSql).toBe(
      `SELECT ${LIKE_SEARCH_SELECT_COLUMNS} FROM browsing_logs ` +
        'WHERE is_deleted = 0 AND (url LIKE ? OR title LIKE ? OR summary LIKE ? OR tags LIKE ?) ' +
        'AND is_deleted = 0 AND domain = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
    );
    expect(stmts.countParams).toEqual(['%hello%', '%hello%', '%hello%', '%hello%', 'example.com']);
    expect(stmts.rowsParams).toEqual(['%hello%', '%hello%', '%hello%', '%hello%', 'example.com', 20, 0]);
  });

  it('excludeDeleted:false drops the deleted filter on both paths', () => {
    const extra = buildExtraWhereSql({ excludeDeleted: false });
    const fts = buildFtsSearchStatements(extra, {
      ftsQuery: '"x"',
      orderClause: 'rank',
      limit: 10,
      offset: 0,
    });
    const like = buildLikeSearchStatements(extra, {
      likePattern: '%x%',
      orderClause: 'created_at DESC',
      limit: 10,
      offset: 0,
    });
    expect(fts.countSql).not.toContain('is_deleted');
    expect(fts.rowsSql).not.toContain('is_deleted');
    expect(like.countSql).not.toContain('is_deleted');
    expect(like.rowsSql).not.toContain('is_deleted');
  });

  it('tag filter appends to SQL and trails extraParams on both paths', () => {
    const extra = buildExtraWhereSql({});
    const tagFilter = { condition: 'tags LIKE ?', params: ['%ai%'] };
    const fts = buildFtsSearchStatements(extra, {
      ftsQuery: '"x"',
      orderClause: 'rank',
      limit: 10,
      offset: 0,
      tagFilter,
    });
    const like = buildLikeSearchStatements(extra, {
      likePattern: '%x%',
      orderClause: 'created_at DESC',
      limit: 10,
      offset: 0,
      tagFilter,
    });
    expect(fts.countSql).toContain('AND tags LIKE ?');
    expect(fts.countParams).toEqual(['"x"', '%ai%']);
    expect(fts.rowsParams).toEqual(['"x"', '%ai%', 10, 0]);
    expect(like.countSql).toContain('AND tags LIKE ?');
    expect(like.countParams).toEqual(['%x%', '%x%', '%x%', '%x%', '%ai%']);
    expect(like.rowsParams).toEqual(['%x%', '%x%', '%x%', '%x%', '%ai%', 10, 0]);
  });

  it('the only surviving SELECT difference is FTS rank (+b. qualification)', () => {
    const ftsCols = FTS_SEARCH_SELECT_COLUMNS.split(', ');
    const likeCols = LIKE_SEARCH_SELECT_COLUMNS.split(', ');
    expect(ftsCols).toHaveLength(12);
    expect(likeCols).toHaveLength(11);
    expect(ftsCols).toContain('rank AS rank');
    // Every LIKE column reappears b.-qualified in the FTS projection.
    for (const col of likeCols) {
      expect(ftsCols).toContain(`b.${col}`);
    }
  });
});

describe('unified ORDER builder keeps the 3-brother semantics', () => {
  it('plain path validates columns and maps rank -> created_at', () => {
    expect(buildOrderByClause({}).orderClause).toBe('ORDER BY created_at DESC');
    expect(buildOrderByClause({ orderBy: 'rank' }).orderClause).toBe('ORDER BY created_at DESC');
    const bad = buildOrderByClause(invalidQuery({ orderBy: 'DROP TABLE' }));
    expect(bad.error).toContain('Invalid orderBy');
  });

  it('FTS path defaults to rank, qualifies created_at', () => {
    expect(buildFts5OrderClause({}).orderClause).toBe('rank');
    expect(buildFts5OrderClause({ orderBy: 'created_at' }).orderClause).toBe(
      'b.created_at DESC, b.id DESC',
    );
    expect(buildFts5OrderClause({ orderBy: 'created_at', orderDir: 'ASC' }).orderClause).toBe(
      'b.created_at ASC, b.id ASC',
    );
  });

  it('LIKE path coerces non-created_at to created_at DESC (dir ignored)', () => {
    expect(buildLikeOrderClause({}).orderClause).toBe('created_at DESC');
    expect(buildLikeOrderClause({ orderBy: 'created_at', orderDir: 'ASC' }).orderClause).toBe(
      'created_at ASC',
    );
    expect(buildLikeOrderClause({ orderBy: 'rank' }).orderClause).toBe('created_at DESC');
    // orderBy absent with ASC still coerces — the unified mapper preserves it.
    expect(buildLikeOrderClause({ orderDir: 'ASC' }).orderClause).toBe('created_at DESC');
  });

  it('invalid orderDir errors on all three paths (shared resolveOrderDir)', () => {
    const bad = invalidQuery({ orderDir: 'XSS' });
    expect(buildOrderByClause(bad).error).toContain('Invalid orderDir');
    expect(buildFts5OrderClause(bad).error).toContain('Invalid orderDir');
    expect(buildLikeOrderClause(bad).error).toContain('Invalid orderDir');
  });

  it('buildSearchOrderClause dispatch is preserved (fts flag + coerce policy)', () => {
    expect(buildSearchOrderClause({}, { fts: true }).orderClause).toBe('rank');
    expect(buildSearchOrderClause({}, { fts: false }).orderClause).toBe('created_at DESC');
    const bad = invalidQuery({ orderDir: 'XSS' });
    expect(buildSearchOrderClause(bad, { fts: true }).error).toContain('Invalid orderDir');
    // coerce policy normalizes to DESC instead of failing closed.
    expect(buildSearchOrderClause(bad, { fts: true, onInvalid: 'coerce' }).orderClause).toBe(
      'rank',
    );
    expect(
      buildSearchOrderClause(bad, { fts: false, onInvalid: 'coerce' }).orderClause,
    ).toBe('created_at DESC');
  });
});
