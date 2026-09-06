/**
 * Spike F-2 (PBI 2026-09-06-05 着手条件):
 * Two REAL sqlite-wasm engines (memory storage) coexisting in one JS context,
 * with interleaved operations — the core feasibility question for the
 * temp-open feature. The production second-engine path uses OPFS storage, so
 * this spike verifies wasm-level isolation; OPFS sync access handle limits
 * remain to be confirmed in the @extension e2e environment.
 *
 * API note: @subframe7536/sqlite-wasm's SQLiteDB exposes `run` (async, returns
 * rows) / `close` — there is no synchronous `exec` (the production
 * OpfsWorkerBackend wraps a different sqlite build with exec/query).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initSQLite, useMemoryStorage, type SQLiteDB } from '@subframe7536/sqlite-wasm';
import fs from 'node:fs';
import path from 'node:path';

// Vite's `?url` transform yields a dev-server URL that fetch() cannot resolve
// in the node environment — serve the wasm as a data: URL instead.
const wasmPath = path.resolve(__dirname, '../../../node_modules/@subframe7536/sqlite-wasm/dist/wa-sqlite.wasm');
const wasmUrl = 'data:application/wasm;base64,' + fs.readFileSync(wasmPath).toString('base64');

const MAIN_DDL =
  'CREATE TABLE browsing_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL, title TEXT, created_at INTEGER NOT NULL, is_starred INTEGER DEFAULT 0)';
const ARCHIVE_DDL =
  'CREATE TABLE browsing_logs (id INTEGER PRIMARY KEY, url TEXT NOT NULL, title TEXT, created_at INTEGER NOT NULL, is_starred INTEGER DEFAULT 0)';

async function openEngine(dbName: string, ddl: string): Promise<SQLiteDB> {
  const db = await initSQLite(useMemoryStorage({ url: wasmUrl }), dbName);
  await db.run(ddl);
  return db;
}

let mainDb: SQLiteDB;
let archiveDb: SQLiteDB;

beforeAll(async () => {
  mainDb = await openEngine('spike-main.db', MAIN_DDL);
  archiveDb = await openEngine('spike-archive.db', ARCHIVE_DDL);
});

describe('Spike F-2: two real sqlite-wasm engines coexisting', () => {
  it('both engines accept interleaved writes without cross-talk', async () => {
    await mainDb.run(
      "INSERT INTO browsing_logs (url, title, created_at) VALUES ('https://main.test/1', 'm1', 100)",
    );
    await archiveDb.run(
      "INSERT INTO browsing_logs (id, url, title, created_at) VALUES (1, 'https://archive.test/1', 'a1', 50)",
    );

    const mainRows = await mainDb.run<{ url: string }>(
      "SELECT url FROM browsing_logs WHERE url LIKE 'https://main%'",
    );
    const archiveRows = await archiveDb.run<{ url: string }>(
      "SELECT url FROM browsing_logs WHERE url LIKE 'https://archive%'",
    );

    expect(mainRows).toHaveLength(1);
    expect(archiveRows).toHaveLength(1);
    expect(mainRows[0].url).toBe('https://main.test/1');
    expect(archiveRows[0].url).toBe('https://archive.test/1');
  });

  it('main engine survives 500 interleaved archive inserts (bulk pressure)', async () => {
    await archiveDb.run('BEGIN');
    for (let i = 2; i <= 501; i++) {
      await archiveDb.run(
        `INSERT INTO browsing_logs (id, url, title, created_at) VALUES (${i}, 'https://archive.test/${i}', 'a${i}', 50)`,
      );
    }
    await archiveDb.run('COMMIT');

    const before = await mainDb.run<{ c: number }>('SELECT COUNT(*) AS c FROM browsing_logs');
    expect(Number(before[0].c)).toBe(1);

    await mainDb.run(
      "INSERT INTO browsing_logs (url, title, created_at) VALUES ('https://main.test/2', 'm2', 200)",
    );
    const after = await mainDb.run<{ c: number }>('SELECT COUNT(*) AS c FROM browsing_logs');
    expect(Number(after[0].c)).toBe(2);
  });

  it('close on the second engine leaves the main engine usable', async () => {
    await archiveDb.close();

    await mainDb.run(
      "INSERT INTO browsing_logs (url, title, created_at) VALUES ('https://main.test/3', 'm3', 300)",
    );
    const rows = await mainDb.run<{ url: string }>(
      'SELECT url FROM browsing_logs ORDER BY created_at',
    );
    expect(rows).toHaveLength(3);
    expect(rows[2].url).toBe('https://main.test/3');
  });
});
