/**
 * opfsSpike.ts
 * OPFS feasibility spike harness (PBI-10).
 *
 * Runs an end-to-end check of strategy 案B (OriginPrivateFileSystemVFS on the
 * offscreen main thread): open DB → create table → insert → select → FTS5 → verify
 * persistence. Intended for manual verification in a real Chrome MV3 offscreen
 * document; the step-orchestration is unit-tested, the wa-sqlite/OPFS run is not.
 */

import { errorMessage } from '../utils/errorUtils.js';
import { detectLiveVfsStrategy, type VfsStrategy } from './opfsCapabilities.js';

export interface SpikeStep {
  name: string;
  /** Runs the step. Return a human-readable detail string, or nothing. Throw to fail. */
  run: () => Promise<string | void>;
}

export interface SpikeStepResult {
  name: string;
  ok: boolean;
  detail: string;
}

export interface OpfsSpikeReport {
  strategy: VfsStrategy;
  steps: SpikeStepResult[];
  passed: boolean;
  durationMs: number;
}

/**
 * Run spike steps sequentially, stopping at the first failure.
 * `passed` is true only when every step ran and succeeded.
 */
export async function runSpikeSteps(steps: SpikeStep[]): Promise<{ steps: SpikeStepResult[]; passed: boolean }> {
  const results: SpikeStepResult[] = [];
  for (const step of steps) {
    try {
      const detail = await step.run();
      results.push({ name: step.name, ok: true, detail: detail ?? '' });
    } catch (err) {
      results.push({ name: step.name, ok: false, detail: errorMessage(err) });
      break;
    }
  }
  const passed = results.length === steps.length && results.every((r) => r.ok);
  return { steps: results, passed };
}

const SPIKE_DB_FILENAME = 'opfs-spike.db';
const SPIKE_VFS_NAME = 'opfs';
const WORKER_SPIKE_TIMEOUT_MS = 15000;

/**
 * Execute the 案A end-to-end OPFS spike: spawn a Worker that runs wa-sqlite with
 * AccessHandlePoolVFS (createSyncAccessHandle is only permitted inside a Worker).
 * Also verifies that WXT/Vite can bundle a Worker for the offscreen document.
 */
export function runOpfsSpikeA(): Promise<OpfsSpikeReport> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./opfsWorker.js', import.meta.url), { type: 'module' });
    } catch (err) {
      reject(new Error(`Worker construction failed: ${errorMessage(err)}`));
      return;
    }
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error(`OPFS worker spike timed out after ${WORKER_SPIKE_TIMEOUT_MS}ms`));
    }, WORKER_SPIKE_TIMEOUT_MS);

    worker.onmessage = (e: MessageEvent) => {
      clearTimeout(timeout);
      worker.terminate();
      resolve(e.data as OpfsSpikeReport);
    };
    worker.onerror = (e: ErrorEvent) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error(`Worker error: ${e.message || 'unknown'}`));
    };
    worker.postMessage('run');
  });
}

/**
 * Execute the 案B end-to-end OPFS spike against wa-sqlite's OriginPrivateFileSystemVFS.
 * Manual-verification entry point (not unit tested — requires WASM + OPFS).
 */
export async function runOpfsSpikeB(): Promise<OpfsSpikeReport> {
  const started = Date.now();
  const { strategy } = detectLiveVfsStrategy();

  // Lazily import WASM/VFS so this module stays importable in node-based tests.
  const [{ default: SQLiteESMFactory }, SQLite, { OriginPrivateFileSystemVFS }] = await Promise.all([
    import('wa-sqlite/dist/wa-sqlite-async.mjs'),
    import('wa-sqlite'),
    import('wa-sqlite/src/examples/OriginPrivateFileSystemVFS.js'),
  ]);

  let sqlite3: ReturnType<typeof SQLite.Factory> | null = null;
  let db: number | null = null;

  const steps: SpikeStep[] = [
    {
      name: 'opfs-root (navigator.storage.getDirectory)',
      run: async () => {
        const root = await navigator.storage.getDirectory();
        // Round-trip a real file to prove OPFS itself works, independent of wa-sqlite.
        const fh = await root.getFileHandle('opfs-probe.txt', { create: true });
        const writable = await fh.createWritable();
        await writable.write('ok');
        await writable.close();
        return `OPFS root reachable; wrote opfs-probe.txt`;
      },
    },
    {
      name: 'open-db (OriginPrivateFileSystemVFS)',
      run: async () => {
        const module = await SQLiteESMFactory();
        if (!module.registerVFS && typeof module.vfs_register === 'function') {
          module.registerVFS = module.vfs_register;
        }
        sqlite3 = SQLite.Factory(module);
        const vfs = new OriginPrivateFileSystemVFS();
        if (typeof (vfs as { hasAsyncMethod?: unknown }).hasAsyncMethod !== 'function') {
          (vfs as unknown as { hasAsyncMethod: () => boolean }).hasAsyncMethod = () => true;
        }
        sqlite3.vfs_register(vfs as unknown as Parameters<typeof sqlite3.vfs_register>[0], true);
        try {
          db = await sqlite3.open_v2(
            SPIKE_DB_FILENAME,
            SQLite.SQLITE_OPEN_CREATE | SQLite.SQLITE_OPEN_READWRITE,
            SPIKE_VFS_NAME
          );
        } catch (err) {
          const code = (err as { code?: unknown })?.code;
          throw new Error(`${errorMessage(err)}${code !== undefined ? ` [code=${String(code)}]` : ''}`);
        }
        return `opened ${SPIKE_DB_FILENAME} on vfs '${SPIKE_VFS_NAME}'`;
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
        await sqlite3!.exec(db!, "CREATE VIRTUAL TABLE IF NOT EXISTS spike_fts USING fts5(body)");
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
        return 'db closed (reopen separately to confirm persistence)';
      },
    },
  ];

  const { steps: results, passed } = await runSpikeSteps(steps);
  return { strategy, steps: results, passed, durationMs: Date.now() - started };
}
