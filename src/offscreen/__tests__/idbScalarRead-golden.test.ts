// @vitest-environment node
/**
 * idbScalarRead-golden.test.ts — PBI 2026-10-09-05 (NN05)
 *
 * Golden pin for the single-cell scalar reads on IdbVfsBackend, measured on a
 * REAL SQLite (better-sqlite3, as the archive e2e uses). Every value asserted
 * here was produced by the hand-written `let … execWithCache(cb)` reads before
 * the `scalar()` helper landed; the refactor must leave them identical
 * (SQL, binds, and the Number-coerced first-cell semantics).
 *
 * The existing parity suite compares IDB against the OPFS worker; this one
 * pins the IDB numbers themselves so the helper extraction has a direct
 * same-before/same-after net independent of the other backend.
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL, FTS5_STATEMENTS, AUDIT_LOG_SCHEMA_SQL } from '../schema.js';
import { IdbVfsBackend } from '../IdbVfsBackend.js';
import type { SqliteValue } from '../sqliteEngine.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  for (const stmt of FTS5_STATEMENTS) db.exec(stmt);
  db.exec(AUDIT_LOG_SCHEMA_SQL);
  return db;
}

/** Minimal IdbVfsBackendHost over real SQLite: positional SELECT rows, raw writes. */
function makeBackend(db: Database.Database): IdbVfsBackend {
  const host = {
    idbEngine: {},
    fts5Available: true,
    cachedCompileOptions: null,
    execWithCache: async (
      sql: string,
      params: SqliteValue[] = [],
      callback?: (row: SqliteValue[]) => void,
    ): Promise<void> => {
      if (/^\s*SELECT/i.test(sql)) {
        const rows = db.prepare(sql).raw(true).all(...(params as (string | number | null)[])) as SqliteValue[][];
        for (const row of rows) callback?.(row);
      } else {
        db.prepare(sql).run(...(params as (string | number | null)[]));
      }
    },
  };
  return new IdbVfsBackend(host as never);
}

describe('IdbVfsBackend scalar reads: golden pin (pre/post scalar() refactor)', () => {
  it('insert/insertBatch/query total/getCount/toggleStar/getFtsIndexSize keep their numbers', async () => {
    const backend = makeBackend(makeDb());

    // insert → SELECT last_insert_rowid()
    expect(await backend.insert({ url: 'https://a.test/1', title: 'A', created_at: 1000, content: 'a' }))
      .toEqual({ success: true, id: 1 });
    expect(await backend.insert({ url: 'https://a.test/2', title: 'B', created_at: 2000, content: 'b' }))
      .toEqual({ success: true, id: 2 });

    // getCount → LIVE_COUNT_SQL
    expect(await backend.getCount()).toEqual({ success: true, count: 2 });

    // insertBatch → SELECT changes() per row (one new, one unique-index skip)
    expect(await backend.insertBatch([
      { url: 'https://a.test/3', title: 'C', created_at: 3000, content: 'c' },
      { url: 'https://a.test/1', title: 'dup', created_at: 1000, content: 'dup' },
    ])).toEqual({ success: true, inserted: 1, skipped: 1 });

    expect(await backend.getCount()).toEqual({ success: true, count: 3 });

    // query (plain listing) → COUNT(*) AS c total
    const q = await backend.query({ limit: 10, orderBy: 'created_at', orderDir: 'ASC' });
    expect(q.success && q.total).toBe(3);
    expect(q.success && q.rows.map((r) => r.title)).toEqual(['A', 'B', 'C']);

    // toggleStar → SELECT is_starred
    expect(await backend.toggleStar(1)).toEqual({ success: true, is_starred: 1 });
    expect(await backend.toggleStar(1)).toEqual({ success: true, is_starred: 0 });

    // getFtsIndexSize → SELECT COUNT(*) FROM browsing_logs_fts
    expect(await backend.getFtsIndexSize()).toEqual({ success: true, count: 3 });
  });

  it('audit log insert id and query total keep their numbers', async () => {
    const backend = makeBackend(makeDb());

    // insertAuditLog → SELECT last_insert_rowid()
    expect(await backend.insertAuditLog({ provider: 'gemini', url: 'https://a.test/1', created_at: 1000 }))
      .toEqual({ success: true, id: 1 });
    expect(await backend.insertAuditLog({ provider: 'openai', url: 'https://a.test/2', created_at: 2000 }))
      .toEqual({ success: true, id: 2 });

    // queryAuditLog → COUNT(*) AS c total
    const q = await backend.queryAuditLog({ limit: 10, offset: 0 });
    expect(q.success && q.total).toBe(2);
    expect(q.success && q.rows.map((r) => r.url)).toEqual(['https://a.test/2', 'https://a.test/1']);
  });
});
