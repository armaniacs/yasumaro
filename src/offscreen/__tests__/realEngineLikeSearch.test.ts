/**
 * Real-engine LIKE regression test (PBI 2026-09-12-38).
 *
 * The stub-based parametric suite asserts SQL *shape* (`toContain`) and never
 * executes it — which is how the round-12 "one qualified ExtraWhere for both
 * paths" regression (LIKE SQL carrying `b.`-qualified columns against the
 * unaliased `browsing_logs` table → `no such column: b.is_deleted` on every
 * 1-2 char IDB text search) survived. This suite EXECUTES the emitted SQL
 * against a real engine (better-sqlite3, the same reader the archive e2e
 * uses) so shape regressions fail here first.
 */
import Database from 'better-sqlite3';
import { describe, it, expect } from 'vitest';
import { buildLikeSearchStatements, buildExtraWhereSql, buildFtsSearchStatements } from '../queryPlan.js';
import type { ExtraWhere } from '../queryPlan.js';
import type { StorageQuery } from '../utils/sqlite-types.js';

const CREATE_TABLE =
  `CREATE TABLE browsing_logs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     url TEXT, title TEXT, summary TEXT, tags TEXT,
     created_at INTEGER, domain TEXT,
     visit_duration INTEGER, scroll_ratio REAL,
     is_starred INTEGER DEFAULT 0, is_deleted INTEGER DEFAULT 0,
     obsidian_synced INTEGER DEFAULT 0, gist_synced INTEGER DEFAULT 0
   )`;

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(CREATE_TABLE);
  db.prepare(
    'INSERT INTO browsing_logs (url, title, summary, tags, created_at, domain, is_starred, is_deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('https://a.com/rune-stone', 'Rune Stone', 'a rune summary', '#runes', 1000, 'a.com', 0, 0);
  db.prepare(
    'INSERT INTO browsing_logs (url, title, summary, tags, created_at, domain, is_starred, is_deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('https://b.com/other', 'Other', 'other summary', '#other', 2000, 'b.com', 0, 1); // deleted
  return db;
}

function toVitestParams(params: unknown[]): unknown[] {
  return params;
}

describe('real-engine LIKE search (PBI 2026-09-12-38)', () => {
  it('short-text search with the qualified->unqualified fix EXECUTES and returns the live row', () => {
    const db = makeDb();
    // The historical regression: `{text: 'ru'}` → useFts=false → the round-12
    // code passed a `b.`-qualified ExtraWhere into buildLikeSearchStatements,
    // whose SQL has no alias → `no such column: b.is_deleted`.
    const q = { text: 'ru', excludeDeleted: true } as unknown as StorageQuery;
    const extra = buildExtraWhereSql(q, { qualified: false });
    const stmts = buildLikeSearchStatements(extra, {
      likePattern: '%ru%',
      orderClause: 'created_at DESC',
      limit: 10,
      offset: 0,
      tagFilter: null,
    });

    const count = db.prepare(stmts.countSql).get(...toVitestParams(stmts.countParams)) as { c: number };
    expect(count.c).toBe(1);

    const rows = db.prepare(stmts.rowsSql).all(...toVitestParams(stmts.rowsParams)) as Array<{ url: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].url).toBe('https://a.com/rune-stone');
  });

  it('short-text search with a domain filter EXECUTES (regression: b.domain against no alias)', () => {
    const db = makeDb();
    const q = { text: 'ru', domain: 'a.com' } as unknown as StorageQuery;
    const extra = buildExtraWhereSql(q, { qualified: false });
    const stmts = buildLikeSearchStatements(extra, {
      likePattern: '%ru%',
      orderClause: 'created_at DESC',
      limit: 10,
      offset: 0,
      tagFilter: null,
    });

    const rows = db.prepare(stmts.rowsSql).all(...toVitestParams(stmts.rowsParams)) as Array<{ url: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].url).toBe('https://a.com/rune-stone');
  });

  it('short-text search with ids filter EXECUTES (regression: b.id IN against no alias)', () => {
    const db = makeDb();
    const row = db.prepare('SELECT id FROM browsing_logs WHERE url = ?').get('https://a.com/rune-stone') as { id: number };
    const q = { text: 'ru', ids: [row.id] } as unknown as StorageQuery;
    const extra = buildExtraWhereSql(q, { qualified: false });
    const stmts = buildLikeSearchStatements(extra, {
      likePattern: '%ru%',
      orderClause: 'created_at DESC',
      limit: 10,
      offset: 0,
      tagFilter: null,
    });

    const rows = db.prepare(stmts.rowsSql).all(...toVitestParams(stmts.rowsParams)) as Array<{ url: string }>;
    expect(rows).toHaveLength(1);
  });

  it('the round-12 regression SQL (b.qualified on unaliased table) actually throws — mutation proof', () => {
    const db = makeDb();
    // Prove the test is not tautological: feeding the qualified projection
    // into the LIKE SQL reproduces the historical failure.
    const q = { text: 'ru' } as unknown as StorageQuery;
    const qualifiedExtra = buildExtraWhereSql(q, { qualified: true });
    const stmts = buildLikeSearchStatements(qualifiedExtra, {
      likePattern: '%ru%',
      orderClause: 'created_at DESC',
      limit: 10,
      offset: 0,
      tagFilter: null,
    });
    expect(() => db.prepare(stmts.countSql).get(...toVitestParams(stmts.countParams))).toThrow();
  });
});

describe('real-engine FTS-adjacent sanity (unqualified extras resolve on the JOIN)', () => {
  it('LIKE search with excludeDeleted:false includes the deleted row', () => {
    const db = makeDb();
    const q = { text: 'summary', excludeDeleted: false } as unknown as StorageQuery;
    const extra: ExtraWhere = buildExtraWhereSql(q, { qualified: false });
    const stmts = buildLikeSearchStatements(extra, {
      likePattern: buildLikePatternLike('summary'),
      orderClause: 'created_at DESC',
      limit: 10,
      offset: 0,
      tagFilter: null,
    });
    const rows = db.prepare(stmts.rowsSql).all(...toVitestParams(stmts.rowsParams)) as Array<{ url: string }>;
    expect(rows.map((r) => r.url).sort()).toEqual(['https://a.com/rune-stone', 'https://b.com/other']);
  });
});

function buildLikePatternLike(text: string): string {
  return `%${text}%`;
}

// buildFtsSearchStatements sanity: the FTS JOIN path is qualified and
// executes on a real engine with the alias present.
describe('real-engine FTS-joined search executes (PBI 2026-09-12-38 sanity)', () => {
  it('FTS-joined extra with b. qualification executes when the alias exists', () => {
    const db = makeDb();
    // Simulate the FTS JOIN shape: give the browsing_logs table the `b` alias
    // through the wrapper, then run the qualified extra verbatim (params ride
    // with the condition vector).
    const extra = buildExtraWhereSql({ domain: 'a.com' } as unknown as StorageQuery, { qualified: true });
    const sql = 'SELECT b.id FROM browsing_logs b WHERE 1=1' + extra.extraWhereSql;
    const rows = db.prepare(sql).all(...extra.extraParams) as Array<{ id: number }>;
    expect(rows.length).toBe(1);
  });
});
