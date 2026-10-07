// @vitest-environment jsdom
/**
 * sqliteBackendParity.realEngine.test.ts
 *
 * The stub suites assert which statements a backend *emits*; this one runs
 * them. Both backends are driven over a real SQLite (better-sqlite3, the same
 * reader the archive e2e uses) through the production boot sequence, so a
 * skeleton that assembles the right-looking SQL but reads the wrong thing —
 * or reports a purge count the engine never agreed with — fails here.
 *
 * Every case is a same-input/different-engine pair: what one backend returns
 * is compared against what the other returns for the identical data set.
 */
import Database from 'better-sqlite3';
import { describe, it, expect } from 'vitest';
import { IdbVfsBackend } from '../IdbVfsBackend.js';
import { execWithCache } from '../sqliteEngineContext/idbEngineLifecycle.js';
import { bootSqliteEngine } from '../sqliteBoot.js';
import { handleSearch } from '../opfsWorker/searchHandlers.js';
import {
  handleQuery, handleInsert, handleInsertBatch, handleUpdate,
  handleToggleStar, handleHardDelete, handleGetCount,
} from '../opfsWorker/crudHandlers.js';
import {
  handleContentPurge, handlePurgeOldRecords, handleClearAll,
} from '../opfsWorker/purgeHandlers.js';
import type { HandlerContext } from '../opfsWorker/handlers.js';
import type { SqliteEngine, SqliteRow, SqliteValue } from '../sqliteEngine.js';
import type { BrowsingLogRecord, StorageQuery } from '../../utils/sqlite-types.js';

/** better-sqlite3 behind the engine interface both backends are written against. */
function openEngine(): SqliteEngine {
  const db = new Database(':memory:');
  return {
    async exec(sql, params = []) {
      if (params.length > 0) db.prepare(sql).run(...(params as unknown[]));
      else db.exec(sql);
    },
    async query(sql, params = []) {
      return db.prepare(sql).all(...(params as unknown[])) as SqliteRow[];
    },
    async queryValue(sql, params = []) {
      const row = db.prepare(sql).get(...(params as unknown[])) as SqliteRow | undefined;
      if (!row) return null;
      return (Object.values(row)[0] ?? null) as SqliteValue;
    },
    async close() { db.close(); },
  };
}

/** Two engines booted by the shared boot, each wrapped in its own backend. */
async function makeBackends() {
  const idbRaw = openEngine();
  const workerRaw = openEngine();
  const idbBoot = await bootSqliteEngine(idbRaw);
  const workerBoot = await bootSqliteEngine(workerRaw);

  const idb = new IdbVfsBackend({
    idbEngine: idbRaw,
    fts5Available: idbBoot.fts5Available,
    cachedCompileOptions: idbBoot.compileOptions,
    execWithCache: (sql: string, params?: SqliteValue[], callback?: (row: SqliteValue[]) => void) =>
      execWithCache(idbRaw, sql, params, callback),
  } as never);
  (idb as unknown as { ensureDb: () => void }).ensureDb = () => {};

  return {
    idb,
    idbRaw,
    workerRaw,
    ctx: { engine: workerRaw } as HandlerContext,
    fts5Available: [idbBoot.fts5Available, workerBoot.fts5Available] as const,
    close: async () => { await idbRaw.close(); await workerRaw.close(); },
  };
}

/** Insert the same record through each backend's own insert path. */
async function insertBoth(
  b: Awaited<ReturnType<typeof makeBackends>>,
  record: BrowsingLogRecord,
): Promise<void> {
  const idbRes = await b.idb.insert(record);
  const opfsRes = await handleInsert(b.ctx, record);
  if (!idbRes.success) throw new Error(`idb insert failed: ${idbRes.error}`);
  expect(idbRes.id).toBe(opfsRes.id);
}

async function seeded(records: BrowsingLogRecord[]) {
  const b = await makeBackends();
  for (const record of records) await insertBoth(b, record);
  return b;
}

/** Fields both projections carry — the plain listings differ in width by design. */
const SHARED_FIELDS = [
  'id', 'url', 'title', 'summary', 'tags', 'created_at', 'domain',
  'visit_duration', 'scroll_ratio', 'is_starred',
] as const;

const shared = (rows: readonly Record<string, unknown>[]) =>
  rows.map((r) => Object.fromEntries(SHARED_FIELDS.map((f) => [f, r[f]])));

const idList = (rows: readonly { id: number }[]) => rows.map((r) => r.id).sort((a, b) => a - b);

const SEED: BrowsingLogRecord[] = [
  { url: 'https://runes.example.com/stone', title: 'Rune Stone', summary: 'a rune summary', tags: '#runes', created_at: 100, content: 'rune stone body' },
  { url: 'https://runes.example.com/axe', title: 'Rune Axe', summary: 'sharp rune', tags: '#runes,#tools', created_at: 200, content: 'rune axe body', is_starred: 1 },
  { url: 'https://kitchen.example.com/tea', title: 'Tea', summary: 'nothing here', tags: '#food', created_at: 300, content: 'tea body' },
  { url: 'https://kitchen.example.com/rye', title: 'Rye', summary: 'rye toast', tags: '#food', created_at: 400, content: 'rye body' },
  { url: 'https://runes.example.com/tomb', title: 'Rune Tomb', summary: 'buried rune', tags: '#runes', created_at: 500, content: 'tomb body', is_deleted: 1 },
  { url: 'https://runes.example.com/twin', title: 'Twin rune', summary: 'twin rune', tags: '#runes', created_at: 600, content: 'twin body' },
];

describe('search parity on a real engine', () => {
  const searches: StorageQuery[] = [
    { text: 'rune', limit: 10 },
    { text: 'rune', tag: 'runes', limit: 10 },
    { text: 'ru', limit: 10 },
    { text: 'rune', domain: 'runes.example.com', limit: 10, offset: 1 },
    { text: 'rune', starred: true, limit: 10 },
    { text: 'rune', dateFrom: 150, dateTo: 500, limit: 10 },
  ];

  it.each(searches)('both backends return the same rows and total for %j', async (q) => {
    const b = await seeded(SEED);
    try {
      // Guards the shape of the test: with FTS5 missing every case below would
      // quietly be exercising the LIKE path and prove nothing about the FTS
      // statements.
      expect(b.fts5Available).toEqual([true, true]);

      const idbRes = await b.idb.query(q);
      const opfsRes = await handleSearch(b.ctx, q, b.fts5Available[1]);

      expect(idbRes.success).toBe(true);
      expect(idbRes.success && idbRes.total).toBe(opfsRes.total);
      expect(idbRes.success && shared(idbRes.rows as unknown as Record<string, unknown>[]))
        .toEqual(shared(opfsRes.rows as unknown as Record<string, unknown>[]));
    } finally {
      await b.close();
    }
  });

  it('the 3-char term really takes the FTS path, and the deleted row is filtered on both', async () => {
    const b = await seeded(SEED);
    try {
      const q: StorageQuery = { text: 'rune', limit: 10 };
      const idbRes = await b.idb.query(q);
      const opfsRes = await handleSearch(b.ctx, q, true);

      // Rows 1, 2 and 6 mention a rune; row 5 does too but is soft-deleted.
      expect(opfsRes.total).toBe(3);
      expect(idbRes.success && idbRes.total).toBe(3);
      expect(idList(opfsRes.rows)).toEqual([1, 2, 6]);
      expect(idbRes.success && idList(idbRes.rows)).toEqual([1, 2, 6]);
    } finally {
      await b.close();
    }
  });

  it('FTS rows carry the engine rank, not a shifted codec cell', async () => {
    const b = await seeded(SEED);
    try {
      const q: StorageQuery = { text: 'rune', limit: 10 };
      const idbRes = await b.idb.query(q);
      expect(idbRes.success).toBe(true);
      if (!idbRes.success) return;
      const idbRow = idbRes.rows[0]!;

      // The engine's own rank for the same match, straight from SQLite; the
      // default FTS order is rank, so rows[0] and this LIMIT 1 are the same row.
      const engineRank = await b.idbRaw.query(
        'SELECT rank AS rank FROM browsing_logs_fts JOIN browsing_logs b ON browsing_logs_fts.rowid = b.id WHERE browsing_logs_fts MATCH ? ORDER BY rank LIMIT 1',
        ['rune'],
      );
      // A codec name list wider than the SELECT shifts the rank cell into
      // nav_source_url and zeroes rank instead.
      expect(idbRow.rank).toBe(Number(engineRank[0]!.rank));
      expect(idbRow.rank).not.toBe(0);
      expect((idbRow as unknown as Record<string, unknown>).nav_source_url).toBeUndefined();
    } finally {
      await b.close();
    }
  });

  it('plain filtered listings agree on the fields both projections share', async () => {
    const b = await seeded(SEED);
    try {
      const q: StorageQuery = { domain: 'runes.example.com', limit: 10, offset: 0 };
      const idbRes = await b.idb.query(q);
      const opfsRes = await handleQuery(b.ctx, q as never);

      expect(idbRes.success).toBe(true);
      expect(idbRes.success && idbRes.total).toBe(opfsRes.total);
      expect(idbRes.success && shared(idbRes.rows as unknown as Record<string, unknown>[]))
        .toEqual(shared(opfsRes.rows as unknown as Record<string, unknown>[]));
      // The projections themselves stay different widths on purpose.
      expect(idbRes.success && Object.keys(idbRes.rows[0]!).length)
        .toBeGreaterThan(Object.keys(opfsRes.rows[0]!).length);
    } finally {
      await b.close();
    }
  });
});

describe('CRUD parity on a real engine', () => {
  it('insert, batch, update, star, delete and count land identically', async () => {
    const b = await makeBackends();
    try {
      await insertBoth(b, { url: 'https://a.example.com/1', title: 'A', created_at: 10, content: 'a body' });
      await insertBoth(b, { url: 'https://a.example.com/2', title: 'B', created_at: 20, content: 'b body' });
      expect(await b.idb.getCount()).toEqual({ success: true, count: 2 });
      expect(await handleGetCount(b.ctx)).toBe(2);

      // The batch carries a repeat of the first record: the unique index must
      // make both backends count it as skipped, not inserted.
      const batch = [
        { url: 'https://a.example.com/3', title: 'C', created_at: 30, content: 'c body' },
        { url: 'https://a.example.com/1', title: 'A again', created_at: 10, content: 'dup' },
      ];
      expect(await b.idb.insertBatch(batch)).toEqual({ success: true, inserted: 1, skipped: 1 });
      expect(await handleInsertBatch(b.ctx, batch, () => {}, async () => {}))
        .toEqual({ count: 1, inserted: 1, skipped: 1 });

      await b.idb.update(1, { title: 'A renamed' });
      await handleUpdate(b.ctx, { id: 1, changes: { title: 'A renamed' } });
      expect(await b.idb.toggleStar(2)).toEqual({ success: true, is_starred: 1 });
      expect(await handleToggleStar(b.ctx, 2)).toEqual({ is_starred: 1 });

      await b.idb.delete(3);
      await handleHardDelete(b.ctx, 3);
      expect(await b.idb.getCount()).toEqual({ success: true, count: 2 });
      expect(await handleGetCount(b.ctx)).toBe(2);

      const q: StorageQuery = { limit: 10, orderBy: 'created_at', orderDir: 'ASC' };
      const idbRes = await b.idb.query(q);
      const opfsRes = await handleQuery(b.ctx, q as never);
      expect(idbRes.success && shared(idbRes.rows as unknown as Record<string, unknown>[]))
        .toEqual(shared(opfsRes.rows as unknown as Record<string, unknown>[]));
      expect(idbRes.success && idbRes.rows.map((r) => r.title)).toEqual(['A renamed', 'B']);
    } finally {
      await b.close();
    }
  });

  // PBI 2026-10-07-05 fixture: undefined-valued keys next to defined ones.
  // The wire cannot carry undefined (structured clone drops the property),
  // but direct callers can, and the two UPDATE field loops used to disagree:
  // IDB wrote NULL for a key present with an undefined value while the worker
  // skipped it — the same op produced different rows per backend.
  const updateCases: Array<{
    name: string;
    changes: Record<string, unknown>;
    skippedColumn: string;
    seededValue: SqliteValue;
    applied: Record<string, SqliteValue>;
  }> = [
    {
      name: '{ summary, tags: undefined }',
      changes: { summary: 'updated summary', tags: undefined },
      skippedColumn: 'tags',
      seededValue: '#runes',
      applied: { summary: 'updated summary' },
    },
    {
      name: '{ title, is_starred, gist_synced: undefined }',
      changes: { title: 'renamed', is_starred: 1, gist_synced: undefined },
      skippedColumn: 'gist_synced',
      seededValue: 0,
      applied: { title: 'renamed', is_starred: 1 },
    },
    {
      name: '{ content: undefined } (only undefined values)',
      changes: { content: undefined },
      skippedColumn: 'content',
      seededValue: 'rune stone body',
      applied: {},
    },
  ];

  it.each(updateCases)('update with $name writes identical rows on both backends', async ({ changes, skippedColumn, seededValue, applied }) => {
    const b = await seeded(SEED);
    try {
      await b.idb.update(1, changes);
      await handleUpdate(b.ctx, { id: 1, changes: changes as never });

      const cols = 'url, title, summary, tags, is_starred, gist_synced, content';
      const idbRow = await b.idbRaw.query(`SELECT ${cols} FROM browsing_logs WHERE id = 1`);
      const opfsRow = await b.workerRaw.query(`SELECT ${cols} FROM browsing_logs WHERE id = 1`);

      // Same op, same row — the parity pin.
      expect(idbRow).toEqual(opfsRow);
      // The old IDB write-NULL behavior is gone: an undefined-valued key is
      // skipped, so the seeded value survives on BOTH backends.
      expect(idbRow[0]![skippedColumn]).toBe(seededValue);
      expect(opfsRow[0]![skippedColumn]).toBe(seededValue);
      // Defined keys still apply on both (guards against a vacuous skip).
      for (const [col, val] of Object.entries(applied)) {
        expect(idbRow[0]![col]).toBe(val);
        expect(opfsRow[0]![col]).toBe(val);
      }
    } finally {
      await b.close();
    }
  });
});

describe('purge parity on a real engine', () => {
  /**
   * Recent timestamps, oldest first, so a multi-year retention window leaves
   * the age phase a no-op and the cap is the only thing that fires. Epoch-zero
   * timestamps would be "old" to any window and the age phase would silently
   * delete everything, which tests nothing about the cap.
   */
  const NOW = Date.now() - 100_000;
  const rows = (n: number): BrowsingLogRecord[] =>
    Array.from({ length: n }, (_v, i) => ({
      url: `https://p.example.com/${i}`,
      title: `Row ${i}`,
      created_at: NOW + i * 1000,
      content: `body ${i}`,
    }));

  const liveIds = (engine: SqliteEngine) =>
    engine.query('SELECT id FROM browsing_logs ORDER BY id')
      .then((r) => r.map((x) => Number(x.id)));
  const withContent = (engine: SqliteEngine) =>
    engine.query('SELECT id FROM browsing_logs WHERE content IS NOT NULL ORDER BY id')
      .then((r) => r.map((x) => Number(x.id)));

  it('content purge reports the same executed-row count and leaves the same rows', async () => {
    // 10 rows carry content and the cap is 3: both backends must report the 7
    // they actually NULLed, and both must keep the same 3.
    const idb = await seeded(rows(10));
    const opfs = await seeded(rows(10));
    try {
      const idbRes = await idb.idb.purgeContent(undefined, 3, false);
      const opfsRes = await handleContentPurge(opfs.ctx, { maxRecords: 3 });

      expect(idbRes).toEqual({ success: true, purged: 7 });
      expect(opfsRes).toEqual({ purged: 7 });
      expect(idbRes.success ? idbRes.purged : -1).toBe(opfsRes.purged);
      // The cap evicts the oldest, so the survivors are the newest three.
      expect(await withContent(idb.idbRaw)).toEqual([8, 9, 10]);
      expect(await withContent(opfs.workerRaw)).toEqual([8, 9, 10]);
    } finally {
      await idb.close();
      await opfs.close();
    }
  });

  it('age-based content purge reports the same count on both', async () => {
    const aged: BrowsingLogRecord[] = [
      { url: 'https://p.example.com/old1', title: 'old1', created_at: 0, content: 'x' },
      { url: 'https://p.example.com/old2', title: 'old2', created_at: 1, content: 'x' },
      { url: 'https://p.example.com/new', title: 'new', created_at: Date.now(), content: 'x' },
    ];
    const idb = await seeded(aged);
    const opfs = await seeded(aged);
    try {
      expect(await idb.idb.purgeContent(1, 0, false)).toEqual({ success: true, purged: 2 });
      expect(await handleContentPurge(opfs.ctx, { retentionDays: 1, maxRecords: 0 }))
        .toEqual({ purged: 2 });
      expect(await withContent(idb.idbRaw)).toEqual([3]);
      expect(await withContent(opfs.workerRaw)).toEqual([3]);
    } finally {
      await idb.close();
      await opfs.close();
    }
  });

  it('record purge (cap only) reports the same count and leaves the same rows', async () => {
    // A 3650-day window makes the age phase a no-op, so the cap is the only
    // thing that fires: 10 rows over a cap of 7 evict the three oldest.
    const idb = await seeded(rows(10));
    const opfs = await seeded(rows(10));
    try {
      expect(await idb.idb.purgeOldRecords(3650, 7)).toEqual({ success: true, purged: 3 });
      expect(await handlePurgeOldRecords(opfs.ctx, { retentionDays: 3650, maxRecords: 7 }, { postLog: () => {} }))
        .toEqual({ purged: 3 });
      expect(await liveIds(idb.idbRaw)).toEqual([4, 5, 6, 7, 8, 9, 10]);
      expect(await liveIds(opfs.workerRaw)).toEqual([4, 5, 6, 7, 8, 9, 10]);
    } finally {
      await idb.close();
      await opfs.close();
    }
  });

  it('record purge (age + cap together) sums both steps the same way on both', async () => {
    // Two ancient unstarred rows go with the window, then the cap evicts two
    // more — 4 in total, and the reported number must be the sum of what ran,
    // not the cap excess alone.
    const mixed: BrowsingLogRecord[] = [
      { url: 'https://p.example.com/ancient1', title: 'ancient1', created_at: 0, content: 'x' },
      { url: 'https://p.example.com/ancient2', title: 'ancient2', created_at: 1, content: 'x' },
      ...rows(8),
    ];
    const idb = await seeded(mixed);
    const opfs = await seeded(mixed);
    try {
      expect(await idb.idb.purgeOldRecords(1, 6)).toEqual({ success: true, purged: 4 });
      expect(await handlePurgeOldRecords(opfs.ctx, { retentionDays: 1, maxRecords: 6 }, { postLog: () => {} }))
        .toEqual({ purged: 4 });
      expect(await liveIds(idb.idbRaw)).toEqual([5, 6, 7, 8, 9, 10]);
      expect(await liveIds(opfs.workerRaw)).toEqual([5, 6, 7, 8, 9, 10]);
    } finally {
      await idb.close();
      await opfs.close();
    }
  });

  it('a starred row survives a cap purge on both backends', async () => {
    const withStar = rows(6);
    withStar[0] = { ...withStar[0]!, is_starred: 1 };
    const idb = await seeded(withStar);
    const opfs = await seeded(withStar);
    try {
      const idbRes = await idb.idb.purgeOldRecords(3650, 4);
      const opfsRes = await handlePurgeOldRecords(opfs.ctx, { retentionDays: 3650, maxRecords: 4 }, { postLog: () => {} });
      expect(idbRes.success ? idbRes.purged : -1).toBe(opfsRes.purged);
      expect(await liveIds(idb.idbRaw)).toEqual([1, 4, 5, 6]);
      expect(await liveIds(opfs.workerRaw)).toEqual([1, 4, 5, 6]);
    } finally {
      await idb.close();
      await opfs.close();
    }
  });

  it('clear_all empties both backends and the audit trail with them', async () => {
    const idb = await makeBackends();
    const opfs = await makeBackends();
    try {
      for (const b of [idb, opfs]) {
        await insertBoth(b, { url: 'https://p.example.com/1', title: 'x', created_at: 1 });
        await b.idbRaw.exec('INSERT INTO audit_log (provider, url, created_at) VALUES (?, ?, ?)', ['p', 'https://p.example.com/1', 1]);
        await b.workerRaw.exec('INSERT INTO audit_log (provider, url, created_at) VALUES (?, ?, ?)', ['p', 'https://p.example.com/1', 1]);
      }

      expect(await idb.idb.clearAll()).toEqual({ success: true });
      await handleClearAll(opfs.ctx, true);

      for (const engine of [idb.idbRaw, opfs.workerRaw]) {
        expect(await engine.query('SELECT COUNT(*) AS c FROM browsing_logs').then((r) => Number(r[0]?.c)))
          .toBe(0);
        expect(await engine.query('SELECT COUNT(*) AS c FROM audit_log').then((r) => Number(r[0]?.c)))
          .toBe(0);
      }
    } finally {
      await idb.close();
      await opfs.close();
    }
  });
});
