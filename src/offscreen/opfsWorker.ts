/**
 * opfsWorker.ts
 * OPFS spike worker (PBI-10, 案A). Runs wa-sqlite with the synchronous build and
 * AccessHandlePoolVFS inside a Worker, where createSyncAccessHandle is permitted.
 *
 * Receives 'run' from the offscreen document and posts back an OpfsSpikeReport.
 */
/// <reference lib="webworker" />

// Proven-working OPFS pairing (spike PBI-10): synchronous wa-sqlite build +
// AccessHandlePoolVFS, inside a Worker (createSyncAccessHandle is Worker-only).
// NOTE: the npm sync build lacks FTS5 — PBI-12 must rebuild dist/wa-sqlite.mjs with
// -DSQLITE_ENABLE_FTS5 (see vendor/wa-sqlite/build-wasm.sh) for full-text search.
import SQLiteESMFactory from 'wa-sqlite/dist/wa-sqlite.mjs';
import * as SQLite from 'wa-sqlite';
import { AccessHandlePoolVFS } from 'wa-sqlite/src/examples/AccessHandlePoolVFS.js';
import { errorMessage } from '../utils/errorUtils.js';
import { runSpikeSteps, type SpikeStep, type OpfsSpikeReport } from './opfsSpike.js';

const POOL_DIR = '/opfs-spike-pool-fts5';
const SPIKE_DB_FILENAME = 'spike.db';

async function runWorkerSpike(): Promise<OpfsSpikeReport> {
  const started = Date.now();
  let sqlite3: ReturnType<typeof SQLite.Factory> | null = null;
  let db: number | null = null;

  const steps: SpikeStep[] = [
    {
      name: 'open-db (AccessHandlePoolVFS @ Worker)',
      run: async () => {
        const module = await SQLiteESMFactory();
        if (!module.registerVFS && typeof module.vfs_register === 'function') {
          module.registerVFS = module.vfs_register;
        }
        sqlite3 = SQLite.Factory(module);
        const vfs = new AccessHandlePoolVFS(POOL_DIR);
        // Synchronous VFS: report no async methods if the shim is missing (v1.0.0).
        if (typeof (vfs as { hasAsyncMethod?: unknown }).hasAsyncMethod !== 'function') {
          (vfs as unknown as { hasAsyncMethod: () => boolean }).hasAsyncMethod = () => false;
        }
        await (vfs as unknown as { isReady: Promise<void> }).isReady;
        sqlite3.vfs_register(vfs as unknown as Parameters<typeof sqlite3.vfs_register>[0], true);
        try {
          db = await sqlite3.open_v2(
            SPIKE_DB_FILENAME,
            SQLite.SQLITE_OPEN_CREATE | SQLite.SQLITE_OPEN_READWRITE,
            (vfs as unknown as { name: string }).name
          );
        } catch (err) {
          const code = (err as { code?: unknown })?.code;
          throw new Error(`${errorMessage(err)}${code !== undefined ? ` [code=${String(code)}]` : ''}`);
        }
        return `opened ${SPIKE_DB_FILENAME} on AccessHandlePool`;
      },
    },
    {
      name: 'create-table',
      run: async () => {
        await sqlite3!.exec(db!, 'CREATE TABLE IF NOT EXISTS spike(id INTEGER PRIMARY KEY, body TEXT)');
      },
    },
    {
      name: 'fts5-create',
      run: async () => {
        await sqlite3!.exec(db!, 'CREATE VIRTUAL TABLE IF NOT EXISTS spike_fts USING fts5(body)');
        return 'FTS5 virtual table created';
      },
    },
    {
      name: 'insert',
      run: async () => {
        await sqlite3!.exec(db!, "INSERT INTO spike(body) VALUES ('opfs persistence check')");
        await sqlite3!.exec(db!, "INSERT INTO spike_fts(body) VALUES ('opfs persistence check')");
      },
    },
    {
      name: 'select-count',
      run: async () => {
        let count = 0;
        await sqlite3!.exec(db!, 'SELECT COUNT(*) FROM spike', (row) => { count = Number(row[0]); });
        if (count < 1) throw new Error(`expected >=1 row, got ${count}`);
        return `row count = ${count}`;
      },
    },
    {
      name: 'fts5-match',
      run: async () => {
        let hits = 0;
        await sqlite3!.exec(db!, "SELECT COUNT(*) FROM spike_fts WHERE spike_fts MATCH 'persistence'", (row) => { hits = Number(row[0]); });
        if (hits < 1) throw new Error(`FTS5 MATCH returned ${hits} hits`);
        return `FTS5 match hits = ${hits}`;
      },
    },
    {
      name: 'close',
      run: async () => {
        if (db != null && sqlite3) await sqlite3.close(db);
        db = null;
        return 'db closed';
      },
    },
  ];

  const { steps: results, passed } = await runSpikeSteps(steps);
  return { strategy: 'opfs-sync-worker', steps: results, passed, durationMs: Date.now() - started };
}

self.onmessage = (e: MessageEvent) => {
  if (e.data !== 'run') return;
  runWorkerSpike()
    .then((report) => self.postMessage(report))
    .catch((err) => self.postMessage({
      strategy: 'opfs-sync-worker',
      steps: [{ name: 'worker', ok: false, detail: errorMessage(err) }],
      passed: false,
      durationMs: 0,
    } satisfies OpfsSpikeReport));
};
