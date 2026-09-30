// @vitest-environment jsdom
/**
 * sqliteBackendUnification.test.ts
 *
 * The OPFS worker and the IDB VFS backend are one product with two VFSes, and
 * four things used to have one implementation per VFS: the database file
 * name, the boot sequence, the purge transaction policy, and what a purge
 * reports as `purged`.
 *
 * The purge-count test is the one that bites. Reporting the *computed* cap
 * excess instead of the engine's executed-row count is only observable when
 * the two differ, so the stub answers `changes()` with a number the excess
 * could not have been; both backends must echo what the engine said.
 *
 * The engines here are stubs — only the issued statement list matters. The
 * same properties are re-checked against a real SQLite in
 * sqliteBackendParity.realEngine.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

/**
 * One recorder per VES, shared by the module mock and the test bodies, so a
 * boot that goes through either path lands in the same list the assertions read.
 */
const boot = vi.hoisted(() => {
  const stmts = { idb: [] as string[], worker: [] as string[] };
  const recorder = (bucket: string[]) => ({
    exec: vi.fn(async (sql: string) => { bucket.push(sql); }),
    query: vi.fn(async (sql: string) => {
      bucket.push(sql);
      return [{ compile_options: 'THREADSAFE=1' }];
    }),
    queryValue: vi.fn(async () => 0),
    close: vi.fn(async () => undefined),
  });
  return { stmts, idbEngine: recorder(stmts.idb), workerEngine: recorder(stmts.worker) };
});

vi.mock('../sqliteEngine.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sqliteEngine.js')>();
  return {
    ...actual,
    createIdbEngine: vi.fn(async () => boot.idbEngine),
    createEngine: vi.fn(async () => boot.workerEngine),
  };
});

vi.mock('../opfsMigrationV2Reader.js', () => ({
  readOldDbRecords: vi.fn().mockResolvedValue([]),
  deleteOldDbFile: vi.fn().mockResolvedValue(undefined),
}));

// The shared chrome mock's storage.local.get answers with a promise and never
// invokes the callback, and the worker's post-open V2 sweep uses the callback
// form — so without this the boot never settles.
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn((_keys: string | string[], callback: (items: Record<string, unknown>) => void) => {
        callback({ opfs_migration_v2_done: true });
      }),
      set: vi.fn((_items: Record<string, unknown>, callback?: () => void) => {
        if (callback) callback();
      }),
    },
  },
} as never);

const { IdbVfsBackend } = await import('../IdbVfsBackend.js');
const { execWithCache, initIdbEngine } = await import('../sqliteEngineContext/idbEngineLifecycle.js');
const { BOOT_PRAGMAS, createMigrationEngine } = await import('../sqliteBoot.js');
const { DB_FILENAME } = await import('../dbFilename.js');
const { handleRequest } = await import('../opfsWorker.js');
const { handleSearch } = await import('../opfsWorker/searchHandlers.js');
const {
  handleContentPurge, handlePurgeOldRecords, handleAuditLogPurge, handleClearAll,
} = await import('../opfsWorker/purgeHandlers.js');
const { __setEngineForTesting } = await import('../opfsWorker.js');

// ---------------------------------------------------------------------------
// Stub engines that record every statement, in order, on both backends
// ---------------------------------------------------------------------------

interface Stmt {
  sql: string;
  params: unknown[];
}

type RowSource = (sql: string) => unknown[];

/** IDB side: routed through the real execWithCache, so row shape is the host's. */
function makeIdb(rows: RowSource) {
  const calls: Stmt[] = [];
  const engine = {
    fts5Available: true,
    exec: vi.fn(async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); }),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return rows(sql);
    }),
    queryValue: vi.fn(async () => null),
    close: vi.fn(async () => undefined),
  };
  const backend = new IdbVfsBackend({
    idbEngine: engine,
    fts5Available: true,
    cachedCompileOptions: null,
    execWithCache: (sql: string, params?: unknown[], callback?: (row: unknown[]) => void) =>
      execWithCache(engine as never, sql, params as never, callback as never),
  } as never);
  (backend as unknown as { ensureDb: () => void }).ensureDb = () => {};
  return { backend, calls };
}

/** OPFS side: routed through the worker's own sqlQuery/sqlExec. */
function makeOpfs(rows: RowSource) {
  const calls: Stmt[] = [];
  const engine = {
    exec: vi.fn(async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); }),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return rows(sql);
    }),
    queryValue: vi.fn(async () => null),
    close: vi.fn(async () => undefined),
  };
  __setEngineForTesting(engine as never, true);
  return { ctx: { engine: engine as never }, calls };
}

/** Answers changes() from a script and COUNT from a fixed value. */
function purgeRows(changes: number[], count: number): RowSource {
  let changeCall = 0;
  return (sql: string) => {
    if (/SELECT changes/i.test(sql)) return [{ c: changes[changeCall++] ?? 0 }];
    if (/SELECT COUNT/i.test(sql)) return [{ c: count }];
    return [];
  };
}

const SEARCH_ROW = {
  id: 1, url: 'https://a.test/1', title: 'A', summary: null, tags: '#news',
  created_at: 100, domain: 'a.test', visit_duration: 5, scroll_ratio: 0.5,
  is_starred: 0, fallback_reason: null, nav_source_url: null, search_query: null, rank: 0,
};

// ---------------------------------------------------------------------------
// 1. The database file name
// ---------------------------------------------------------------------------

describe('database file name: one declaration', () => {
  const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', 'graphify-out']);

  function sourceFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) sourceFiles(full, acc);
      else if (st.isFile() && extname(entry) === '.ts' && !entry.endsWith('.d.ts')) acc.push(full);
    }
    return acc;
  }

  /** Every `const <name> = 'yasumaro.db'` in shipped source, by file. */
  function declarations(): { file: string; name: string }[] {
    const found: { file: string; name: string }[] = [];
    for (const file of sourceFiles(join(process.cwd(), 'src')).sort()) {
      const text = readFileSync(file, 'utf-8');
      const re = /^\s*(?:export\s+)?const\s+(\w*DB_FILENAME\w*)\s*=\s*'yasumaro\.db'\s*;/gm;
      for (const m of text.matchAll(re)) {
        found.push({ file: file.slice(process.cwd().length + 1), name: m[1] });
      }
    }
    return found;
  }

  it('declares DB_FILENAME once, and the legacy name separately', () => {
    // Two spellings of one name in two subsystems is how the file name drifts:
    // renaming one leaves the other pointing at the old file, and the backend
    // then opens a second, empty database rather than failing.
    expect(declarations()).toEqual([
      { file: 'src/messaging/sqliteMessages.ts', name: 'LEGACY_OPFS_DB_FILENAME' },
      { file: 'src/offscreen/dbFilename.ts', name: 'DB_FILENAME' },
    ]);
  });

  it('is still the name the production engines open', () => {
    expect(DB_FILENAME).toBe('yasumaro.db');
  });
});

// ---------------------------------------------------------------------------
// 2. Boot
// ---------------------------------------------------------------------------

describe('boot: the same pragmas, schema and migration adapter on both VFSes', () => {
  beforeEach(() => {
    boot.stmts.idb.length = 0;
    boot.stmts.worker.length = 0;
    __setEngineForTesting(null, false);
  });

  it('runs WAL then wal_autocheckpoint on both, in the same order', async () => {
    // The checkpoint threshold is the point: without it the worker left the
    // WAL to the SQLite default while the host capped it, so the same amount
    // of writing aged differently on the two backends.
    expect(BOOT_PRAGMAS).toEqual([
      'PRAGMA journal_mode=WAL;',
      'PRAGMA wal_autocheckpoint=1000;',
    ]);

    const state = { idbEngine: null, fts5Available: false, cachedCompileOptions: null, lastInitError: null };
    expect(await initIdbEngine(state as never)).toBe(true);
    expect((await handleRequest({ id: 1, type: 'STATUS', payload: {} })).success).toBe(true);

    // Same engine, same boot: the statements up to and including the compile
    // options read are byte-identical, so neither VFS can be missing a step
    // the other has. (STATUS asks for a row count afterwards, and only the
    // worker counts on that path — request handling, not boot.)
    const bootOnly = (stmts: string[]) =>
      stmts.slice(0, stmts.indexOf('PRAGMA compile_options') + 1);
    expect(bootOnly(boot.stmts.idb)).toEqual(bootOnly(boot.stmts.worker));
    expect(boot.stmts.idb.slice(0, 2)).toEqual([...BOOT_PRAGMAS]);
    expect(boot.stmts.idb[2]).toContain('CREATE TABLE IF NOT EXISTS browsing_logs');
    expect(boot.stmts.idb[3]).toContain('CREATE TABLE IF NOT EXISTS audit_log');
    expect(boot.stmts.worker[2]).toContain('CREATE TABLE IF NOT EXISTS browsing_logs');
    expect(boot.stmts.worker[3]).toContain('CREATE TABLE IF NOT EXISTS audit_log');
  });

  it('reads compile options on both backends', async () => {
    const state = { idbEngine: null, fts5Available: false, cachedCompileOptions: null, lastInitError: null };
    await initIdbEngine(state as never);
    expect((await handleRequest({ id: 1, type: 'STATUS', payload: {} })).success).toBe(true);

    expect(state.cachedCompileOptions).toEqual(['THREADSAFE=1']);
    expect(boot.stmts.idb).toContain('PRAGMA compile_options');
    expect(boot.stmts.worker).toContain('PRAGMA compile_options');
  });

  it('maps a row-less queryValue to null, whatever the engine returns for it', async () => {
    // The two hand-written adapters disagreed here: one tested
    // `!== undefined`, the other `!= null`. `queryValue` returns null for a
    // statement with no row, so the first adapter turned it into Number(0) —
    // a present value — and every migration existence probe answered "the
    // column is missing".
    const base = { exec: vi.fn(async () => undefined), query: vi.fn(async () => []) };
    const engineReturning = (queryValue: () => Promise<unknown>) =>
      ({ ...base, queryValue: vi.fn(queryValue), close: vi.fn(async () => undefined) }) as never;

    expect(await createMigrationEngine(engineReturning(async () => null)).queryValue('SELECT 1')).toBeNull();
    expect(await createMigrationEngine(engineReturning(async () => undefined)).queryValue('SELECT 1')).toBeNull();
    expect(await createMigrationEngine(engineReturning(async () => '3')).queryValue('SELECT 1')).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 3. purged = executed rows
// ---------------------------------------------------------------------------

describe('purge: purged is the executed-row count on both backends', () => {
  beforeEach(() => {
    __setEngineForTesting(null, false);
  });

  it('content purge sums changes() on both, never the computed excess', async () => {
    // count 10, cap 3 → the cap statement is handed LIMIT 7, but the engine
    // reports 4 rows touched. Both backends must answer 2 + 4 = 6.
    const idb = makeIdb(purgeRows([2, 4], 10));
    const opfs = makeOpfs(purgeRows([2, 4], 10));

    expect(await idb.backend.purgeContent(30, 3, false)).toEqual({ success: true, purged: 6 });
    expect(await handleContentPurge(opfs.ctx, { retentionDays: 30, maxRecords: 3 }))
      .toEqual({ purged: 6 });

    // The excess is still what the cap LIMIT is built from; only the reported
    // number is now the engine's.
    for (const calls of [idb.calls, opfs.calls]) {
      expect(calls.some((c) => /UPDATE browsing_logs SET content = NULL/.test(c.sql) && c.params[0] === 7))
        .toBe(true);
    }
  });

  it('record purge and audit purge sum changes() on both', async () => {
    const idb = makeIdb(purgeRows([3, 1], 12));
    const opfs = makeOpfs(purgeRows([3, 1], 12));

    expect(await idb.backend.purgeOldRecords(30, 5)).toEqual({ success: true, purged: 4 });
    expect(await handlePurgeOldRecords(opfs.ctx, { retentionDays: 30, maxRecords: 5 }, { postLog: () => {} }))
      .toEqual({ purged: 4 });

    const idbAudit = makeIdb(purgeRows([5], 0));
    const opfsAudit = makeOpfs(purgeRows([5], 0));
    expect(await idbAudit.backend.purgeAuditLog(7)).toEqual({ success: true, purged: 5 });
    expect(await handleAuditLogPurge(opfsAudit.ctx, { retentionDays: 7 })).toEqual({ purged: 5 });
  });
});

// ---------------------------------------------------------------------------
// 4. One transaction per purge
// ---------------------------------------------------------------------------

describe('purge: one transaction per purge, on both backends', () => {
  beforeEach(() => {
    __setEngineForTesting(null, false);
  });

  it.each([
    ['purgeOldRecords',
      (idb: ReturnType<typeof makeIdb>, opfs: ReturnType<typeof makeOpfs>) => [
        idb.backend.purgeOldRecords(30, 5),
        handlePurgeOldRecords(opfs.ctx, { retentionDays: 30, maxRecords: 5 }, { postLog: () => {} }),
      ]],
    ['purgeContent',
      (idb: ReturnType<typeof makeIdb>, opfs: ReturnType<typeof makeOpfs>) => [
        idb.backend.purgeContent(30, 5, false),
        handleContentPurge(opfs.ctx, { retentionDays: 30, maxRecords: 5 }),
      ]],
    ['purgeAuditLog',
      (idb: ReturnType<typeof makeIdb>, opfs: ReturnType<typeof makeOpfs>) => [
        idb.backend.purgeAuditLog(30),
        handleAuditLogPurge(opfs.ctx, { retentionDays: 30 }),
      ]],
  ])('%s opens one transaction and commits it, on both backends', async (_label, run) => {
    // Each of these reads between its writes (changes() feeds the count, the
    // cap COUNT decides the next LIMIT), so a recording landing mid-purge
    // would otherwise let the reported count and the deleted set disagree.
    const idb = makeIdb(purgeRows([0], 0));
    const opfs = makeOpfs(purgeRows([0], 0));
    await Promise.all(run(idb, opfs));

    for (const calls of [idb.calls, opfs.calls]) {
      const sql = calls.map((c) => c.sql);
      expect(sql.filter((s) => s === 'BEGIN IMMEDIATE')).toHaveLength(1);
      expect(sql.filter((s) => s === 'COMMIT')).toHaveLength(1);
      expect(sql).not.toContain('ROLLBACK');
      expect(sql.indexOf('BEGIN IMMEDIATE')).toBeLessThan(sql.indexOf('COMMIT'));
    }
  });

  it('clearAll stays untransacted on both (the documented exception)', async () => {
    // Unconditional deletes with no read between writes, and the IDB path's
    // closing wal_checkpoint cannot run inside a transaction — wrapping it on
    // one backend and not the other would just move the divergence.
    const idb = makeIdb(purgeRows([0], 0));
    const opfs = makeOpfs(purgeRows([0], 0));
    await idb.backend.clearAll();
    await handleClearAll(opfs.ctx, true);

    for (const calls of [idb.calls, opfs.calls]) {
      const sql = calls.map((c) => c.sql);
      expect(sql).not.toContain('BEGIN IMMEDIATE');
      expect(sql).not.toContain('COMMIT');
    }
  });
});

// ---------------------------------------------------------------------------
// 5. One search skeleton
// ---------------------------------------------------------------------------

describe('search: both backends emit the same statements for one query', () => {
  /**
   * The one intended SQL difference: the FTS statements join
   * `browsing_logs AS b`, so the host qualifies its filter columns and the
   * worker has never emitted them qualified. Only qualification before a
   * comparison is stripped — the alias in the projection, the JOIN and the
   * ORDER BY must still match, and the tag sub-select is `b.id` on both.
   */
  const unqualify = (calls: Stmt[]) =>
    calls.map((c) => ({ ...c, sql: c.sql.replace(/\bb\.(?=[a-z_]+\s*[=<>])/g, '') }));

  beforeEach(() => {
    __setEngineForTesting(null, false);
  });

  const rows: RowSource = (sql) => (/SELECT COUNT/i.test(sql) ? [{ c: 1 }] : [SEARCH_ROW]);

  const queries = [
    { text: 'runes', tag: 'news', limit: 20, offset: 0 },
    { text: 'ru', tag: 'news', limit: 20, offset: 0 },
    { text: 'runes', domain: 'a.test', starred: true, dateFrom: 1, dateTo: 999, limit: 5, offset: 5 },
  ] as const;

  it.each(queries)('same statements, same bindings, same rows: %j', async (q) => {
    const idb = makeIdb(rows);
    const opfs = makeOpfs(rows);

    const idbRes = await idb.backend.query(q);
    const opfsRes = await handleSearch(opfs.ctx, q, true);

    expect(idbRes.success).toBe(true);
    expect(idbRes.success && idbRes.total).toBe(opfsRes.total);
    expect(idbRes.success && idbRes.rows.map((r) => r.id)).toEqual(opfsRes.rows.map((r) => r.id));
    // Same search, same statements in the same order with the same bindings:
    // the shared skeleton is the only thing that can guarantee it.
    expect(unqualify(idb.calls)).toEqual(unqualify(opfs.calls));
  });

  it('the LIKE path needs no alias, so it is byte-identical', async () => {
    const idb = makeIdb(rows);
    const opfs = makeOpfs(rows);
    const q = { text: 'ru', domain: 'a.test', limit: 20 };

    await idb.backend.query(q);
    await handleSearch(opfs.ctx, q, true);

    expect(idb.calls).toEqual(opfs.calls);
  });

  it('the FTS path qualifies filter columns on the host only, and says so', async () => {
    // Pinned rather than unified: the worker's unqualified form is what its
    // own statements have always emitted, and a silent "fix" here would move
    // SQL under a live database.
    const ftsRowsSql = (calls: Stmt[]) =>
      calls.find((c) => /browsing_logs_fts MATCH/.test(c.sql) && /ORDER BY/.test(c.sql))!.sql;
    const q = { text: 'runes', domain: 'a.test', limit: 20 };

    const idb = makeIdb(rows);
    const opfs = makeOpfs(rows);
    await idb.backend.query(q);
    await handleSearch(opfs.ctx, q, true);

    expect(ftsRowsSql(idb.calls)).toContain('AND b.domain = ?');
    expect(ftsRowsSql(opfs.calls)).toContain(' AND domain = ?');
  });
});
