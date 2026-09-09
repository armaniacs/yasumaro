// @vitest-environment node
/**
 * rowCodec.test.ts
 * PBI 03: the row codec owns every backend's row mapping.
 *
 * Pins the queryPlan alias contract (`AS c` on every COUNT, `rank AS rank`
 * on every FTS rows query) as a codec guarantee, the mapNamed/mapPositional
 * truth tables (NULLs, rank default, column reorder), and that the IDB
 * positional plain listing agrees with the OPFS named plain listing on a
 * shared fixture for the 13 canonical columns.
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import {
  SEARCH_COLUMNS,
  SEARCH_COLUMNS_WITH_RANK,
  BROWSING_LOG_COLUMNS,
  BROWSING_LOG_COLUMNS_SQL,
  BROWSING_LOG_FULL_COLUMNS,
  BROWSING_LOG_FULL_COLUMNS_SQL,
  mapNamed,
  mapPositional,
  type NamedRow,
} from '../rowCodec.js';
import { COLUMN_NAMES, SCHEMA_SQL, INSERT_SQL, buildInsertParams } from '../schema.js';
import {
  PLAIN_LIST_COLUMNS,
  buildPlainListStatements,
  buildFtsSearchStatements,
  buildLikeSearchStatements,
  buildExtraWhereSql,
} from '../queryPlan.js';
import { IdbVfsBackend } from '../IdbVfsBackend.js';
import { handleQuery } from '../opfsWorker/crudHandlers.js';
import type { SqliteValue } from '../sqliteEngine.js';
import type { BrowsingLogRecord, SearchResult } from '../../utils/sqlite-types.js';

describe('rowCodec column lists', () => {
  it('BROWSING_LOG_COLUMNS is the legacy 13-column plain-list set', () => {
    expect([...BROWSING_LOG_COLUMNS]).toEqual([
      'id', 'url', 'title', 'summary', 'tags', 'created_at', 'domain',
      'visit_duration', 'scroll_ratio', 'is_starred',
      'is_deleted', 'obsidian_synced', 'gist_synced',
    ]);
    expect(BROWSING_LOG_COLUMNS_SQL).toBe(
      'id, url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred, is_deleted, obsidian_synced, gist_synced',
    );
    expect(PLAIN_LIST_COLUMNS).toBe(BROWSING_LOG_COLUMNS_SQL);
  });

  it('full projection is id plus the schema insert order', () => {
    expect([...BROWSING_LOG_FULL_COLUMNS]).toEqual(['id', ...COLUMN_NAMES]);
    expect(BROWSING_LOG_FULL_COLUMNS).toHaveLength(33);
    expect(BROWSING_LOG_FULL_COLUMNS_SQL.startsWith('id, url, title')).toBe(true);
  });
});

describe('mapNamed truth table', () => {
  const row: NamedRow = {
    id: 7,
    url: 'https://x.test/',
    title: null,
    summary: 's',
    tags: null,
    created_at: 123,
    domain: null,
    visit_duration: null,
    scroll_ratio: 0.5,
    is_starred: 1,
  };

  it('maps the search projection with rank from the row', () => {
    expect(mapNamed<SearchResult>({ ...row, rank: -1.25 }, SEARCH_COLUMNS_WITH_RANK)).toEqual({
      ...row,
      rank: -1.25,
    });
  });

  it('defaults a missing rank to 0 (LIKE path)', () => {
    expect(mapNamed<SearchResult>(row, SEARCH_COLUMNS_WITH_RANK)).toMatchObject({ rank: 0 });
  });

  it('keeps NULLs as null instead of coercing', () => {
    const mapped = mapNamed<BrowsingLogRecord>(row, SEARCH_COLUMNS);
    expect(mapped.title).toBeNull();
    expect(mapped.visit_duration).toBeNull();
    expect(mapped.domain).toBeNull();
  });
});

describe('mapPositional truth table', () => {
  it('agrees with mapNamed on a shared search fixture', () => {
    const named: NamedRow = {
      id: 3, url: 'https://y.test/', title: 'T', summary: null, tags: '#a',
      created_at: 456, domain: 'y.test', visit_duration: 12, scroll_ratio: null,
      is_starred: 0, rank: -0.5,
    };
    const positional: SqliteValue[] = [
      3, 'https://y.test/', 'T', null, '#a', 456, 'y.test', 12, null, 0, -0.5,
    ];
    expect(mapPositional<SearchResult>(positional, SEARCH_COLUMNS_WITH_RANK)).toEqual(
      mapNamed<SearchResult>(named, SEARCH_COLUMNS_WITH_RANK),
    );
  });

  it('survives a column reorder (mapping follows the list, not schema order)', () => {
    const columns = ['url', 'id', ...SEARCH_COLUMNS.filter((c) => c !== 'id' && c !== 'url'), 'rank'];
    const cells: SqliteValue[] = ['https://z.test/', 9, 'T', null, '#t', 1, 'z.test', null, null, 1, -2];
    const mapped = mapPositional<SearchResult>(cells, columns);
    expect(mapped.id).toBe(9);
    expect(mapped.url).toBe('https://z.test/');
    expect(mapped.created_at).toBe(1);
    expect(mapped.rank).toBe(-2);
  });

  it('defaults rank to 0 when the LIKE row has no rank cell', () => {
    const cells: SqliteValue[] = [1, 'https://l.test/', null, null, null, 10, null, null, null, 0];
    expect(mapPositional<SearchResult>(cells, SEARCH_COLUMNS_WITH_RANK)).toMatchObject({ rank: 0 });
  });
});

describe('queryPlan alias guarantee (codec contract)', () => {
  const extra = buildExtraWhereSql({});

  it('every COUNT emits AS c for the named-row reader', () => {
    const fts = buildFtsSearchStatements(extra, { ftsQuery: '"x"', orderClause: 'rank', limit: 10, offset: 0 });
    const like = buildLikeSearchStatements(extra, { likePattern: '%x%', orderClause: 'created_at DESC', limit: 10, offset: 0 });
    const plain = buildPlainListStatements(
      { where: 'WHERE is_deleted = 0', order: 'ORDER BY created_at DESC', limit: 10, offset: 0, params: [] },
      { tag: null, columns: BROWSING_LOG_COLUMNS_SQL },
    );
    for (const sql of [fts.countSql, like.countSql, plain.countSql]) {
      expect(sql).toContain('COUNT(*) AS c');
    }
  });

  it('every FTS rows query emits rank AS rank for both readers', () => {
    const fts = buildFtsSearchStatements(extra, { ftsQuery: '"x"', orderClause: 'rank', limit: 10, offset: 0 });
    expect(fts.rowsSql).toContain('rank AS rank');
  });

  it('buildPlainListStatements emits exactly the passed canonical columns', () => {
    const plain = buildPlainListStatements(
      { where: 'WHERE is_deleted = 0', order: 'ORDER BY created_at DESC', limit: 5, offset: 0, params: [] },
      { tag: null, columns: BROWSING_LOG_COLUMNS_SQL },
    );
    expect(plain.rowsSql.startsWith(`SELECT ${BROWSING_LOG_COLUMNS_SQL} FROM browsing_logs`)).toBe(true);
    expect(plain.rowsSql).not.toContain('SELECT *');
  });
});

describe('backend mapping agreement on a shared fixture', () => {
  function seedDb(): Database.Database {
    const db = new Database(':memory:');
    db.exec(SCHEMA_SQL);
    db.prepare(INSERT_SQL).run(
      ...buildInsertParams(
        {
          url: 'https://agree.test/a',
          title: 'Agree',
          summary: null,
          tags: '#news',
          created_at: 1700000000000,
          visit_duration: 42,
          scroll_ratio: 0.75,
          is_starred: 1,
        },
        'agree.test',
      ),
    );
    return db;
  }

  it('IDB positional plain listing matches OPFS named plain listing on the 13 canonical columns', async () => {
    const db = seedDb();
    const host = {
      idbEngine: {},
      fts5Available: false,
      execWithCache: async (sql: string, params: SqliteValue[] = [], cb?: (row: SqliteValue[]) => void): Promise<void> => {
        if (/^\s*SELECT/i.test(sql)) {
          const rows = db.prepare(sql).raw(true).all(...(params as (string | number | null)[])) as SqliteValue[][];
          for (const row of rows) cb?.(row);
        } else {
          db.prepare(sql).run(...(params as (string | number | null)[]));
        }
      },
    };
    const idb = new IdbVfsBackend(host as never);
    const idbResult = await idb.query({ limit: 10 });
    expect(idbResult.success).toBe(true);
    if (!idbResult.success) return;
    expect(idbResult.rows).toHaveLength(1);
    const idbRow = idbResult.rows[0]!;

    const stored = db.prepare('SELECT * FROM browsing_logs').get() as Record<string, string | number | null>;
    const ctx = {
      engine: {
        exec: async (): Promise<void> => undefined,
        query: async (sql: string): Promise<Record<string, string | number | null>[]> => {
          if (/SELECT COUNT/i.test(sql)) return [{ c: 1 }];
          return [stored];
        },
        queryValue: async (): Promise<SqliteValue> => null,
        close: async (): Promise<void> => undefined,
      },
    };
    const opfsResult = await handleQuery(ctx as never, { limit: 10 });
    expect(opfsResult.rows).toHaveLength(1);
    const opfsRow = opfsResult.rows[0]!;

    const picked: Record<string, unknown> = {};
    for (const column of BROWSING_LOG_COLUMNS) picked[column] = (idbRow as unknown as Record<string, unknown>)[column];
    expect(opfsRow).toEqual(picked);
  });
});
