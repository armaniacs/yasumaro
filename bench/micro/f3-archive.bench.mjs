/**
 * f3 — archive create (phase A) batch INSERT at scale.
 *
 * PBI 2026-09-06-02 acceptance F-3: measure the real batch-INSERT pattern used
 * by handleArchiveCreate (SELECT pages by id cursor → INSERT 5000/COMMIT into
 * the archive DB) against 50k / 100k rows, using REAL sqlite-wasm engines
 * (memory storage — the wasm-level cost is what we validate here; OPFS I/O
 * overhead is out of scope, see spike-f2-two-engines.test.ts).
 *
 * The measured unit is one full archive pass (all pages). Batch size mirrors
 * archiveCreateHandlers.ARCHIVE_INSERT_BATCH (5000).
 */
import { initSQLite, useMemoryStorage } from '@subframe7536/sqlite-wasm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const wasmPath = path.resolve(
  projectRoot,
  'node_modules/@subframe7536/sqlite-wasm/dist/wa-sqlite.wasm',
);
const wasmUrl = 'data:application/wasm;base64,' + fs.readFileSync(wasmPath).toString('base64');

const INSERT_BATCH = 5000;

const MAIN_DDL =
  'CREATE TABLE browsing_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL, title TEXT, summary TEXT, tags TEXT, domain TEXT, created_at INTEGER NOT NULL, is_starred INTEGER DEFAULT 0, is_deleted INTEGER DEFAULT 0)';
const ARCHIVE_DDL =
  'CREATE TABLE browsing_logs (id INTEGER PRIMARY KEY, url TEXT NOT NULL, title TEXT, summary TEXT, tags TEXT, domain TEXT, created_at INTEGER NOT NULL, is_starred INTEGER DEFAULT 0, is_deleted INTEGER DEFAULT 0)';

async function openMainWithRows(n) {
  // Seeding is setup cost (unmeasured): one transaction of direct inserts.
  const main = await initSQLite(useMemoryStorage({ url: wasmUrl }), `f3-main-${n}.db`);
  await main.run(MAIN_DDL);
  await main.run('BEGIN');
  for (let i = 1; i <= n; i++) {
    await main.run(
      `INSERT INTO browsing_logs (url, title, summary, tags, domain, created_at, is_starred, is_deleted) ` +
        `VALUES ('https://f3.test/${i}', 't${i}', 's${i}', NULL, 'f3.test', ${1700000000000 + i}, 0, 0)`,
    );
  }
  await main.run('COMMIT');
  return main;
}

async function makeArchiveDb(name) {
  const db = await initSQLite(useMemoryStorage({ url: wasmUrl }), name);
  await db.run(ARCHIVE_DDL);
  return db;
}

async function archivePass(main, archive) {
  const cols = 'id, url, title, summary, tags, domain, created_at, is_starred, is_deleted';
  let inserted = 0;
  let cursor = 0;
  for (;;) {
    const rows = await main.run(
      `SELECT ${cols} FROM browsing_logs WHERE created_at <= ? AND is_deleted = 0 AND id > ? ORDER BY id LIMIT ${INSERT_BATCH}`,
      [Number.MAX_SAFE_INTEGER, cursor],
    );
    if (rows.length === 0) break;
    await archive.run('BEGIN');
    for (const row of rows) {
      await archive.run(
        `INSERT INTO browsing_logs (${cols}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [row.id, row.url, row.title, row.summary, row.tags, row.domain, row.created_at, row.is_starred, row.is_deleted],
      );
    }
    await archive.run('COMMIT');
    inserted += rows.length;
    cursor = Number(rows[rows.length - 1].id);
    if (rows.length < INSERT_BATCH) break;
  }
  return inserted;
}

export const definition = {
  id: 'f3',
  description: 'archive create batch INSERT at scale (PBI 2026-09-06-02 F-3)',
  counters: [],
  sizes: [
    { key: '50k', n: 50000 },
    { key: '100k', n: 100000 },
  ],
  warmup: 0,
  measure: 1,
  async setup(size) {
    const main = await openMainWithRows(size.n);
    const archive = await makeArchiveDb(`f3-archive-${size.n}.db`);
    const count = Number(
      (await main.run('SELECT COUNT(*) AS c FROM browsing_logs'))[0].c,
    );
    return { main, archive, seeded: count };
  },
  async run(ctx) {
    const inserted = await archivePass(ctx.main, ctx.archive);
    if (inserted !== ctx.seeded) {
      throw new Error(`archive pass mismatch: inserted=${inserted} seeded=${ctx.seeded}`);
    }
    return inserted;
  },
  teardown(ctx) {
    try { ctx.archive.close(); } catch { /* ignore */ }
    try { ctx.main.close(); } catch { /* ignore */ }
  },
};
