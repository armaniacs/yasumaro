/**
 * probe-worker.ts — Firefox OPFS verification probe for the wa-sqlite VFS.
 *
 * Mirrors src/offscreen/sqliteEngine.ts (same library, same init options:
 * useOpfsStorage + initSQLite / useIdbStorage + initSQLite) and posts
 * structured results to the host page so the Playwright spec can assert them.
 * Runs as a module worker on an http origin — chrome.offscreen is NOT
 * involved, which isolates the single question under test: does the
 * SyncAccessHandle VFS work against this browser's OPFS implementation.
 */
import { initSQLite } from '@subframe7536/sqlite-wasm';
import { useOpfsStorage } from '@subframe7536/sqlite-wasm/opfs';
import { useIdbStorage } from '@subframe7536/sqlite-wasm/idb';

interface ProbeStep {
  name: string;
  ok: boolean;
  detail?: string;
}

interface ProbeResult {
  userAgent: string;
  caps: {
    /** navigator.storage.getDirectory is available (OPFS root reachable). */
    opfsDirectory: boolean;
    /** FileSystemFileHandle.prototype.createSyncAccessHandle is available. */
    syncAccessHandle: boolean;
  };
  /** Raw OPFS SyncAccessHandle write/read in this worker (no wa-sqlite). */
  rawSah: ProbeStep;
  opfs: { steps: ProbeStep[]; fts5Matched: boolean; persisted: boolean };
  idb: { steps: ProbeStep[]; persisted: boolean };
}

// Resolved next to the bundled worker file (the spec copies the wasm there).
const WASM_URL = new URL('wa-sqlite.wasm', self.location.href).href;
const DB_NAME = 'probe-yasumaro-vfs.db';
const IDB_NAME = 'probe-yasumaro-vfs-idb.db';
const PROBE_BODY = 'yasumaro firefox vfs probe';

function errDetail(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

/** Same wrapper as src/offscreen/sqliteEngine.ts wrapDb — the raw library API is `run`/`close`. */
function wrapDb(db: unknown): {
  exec(sql: string, params?: unknown[]): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
} {
  const runFn = (db as { run: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]> }).run.bind(db);
  const closeFn = (db as { close: () => Promise<void> }).close.bind(db);
  return {
    exec: async (sql, params) => {
      await runFn(sql, params);
    },
    query: async (sql, params) => runFn(sql, params),
    close: async () => {
      await closeFn();
    },
  };
}

async function probeRawSah(): Promise<ProbeStep> {
  const name = 'raw: createSyncAccessHandle write/read';
  try {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle('probe-cap.bin', { create: true });
    const sah = await handle.createSyncAccessHandle();
    const bytes = new Uint8Array([1, 2, 3]);
    sah.write(bytes, { at: 0 });
    sah.flush();
    const readBack = new Uint8Array(bytes.length);
    sah.read(readBack, { at: 0 });
    sah.close();
    const roundTripped = readBack[0] === 1 && readBack[2] === 3;
    return { name, ok: roundTripped, detail: roundTripped ? undefined : 'bytes did not round-trip' };
  } catch (e) {
    return { name, ok: false, detail: errDetail(e) };
  }
}

async function probeOpfs(): Promise<{ steps: ProbeStep[]; fts5Matched: boolean; persisted: boolean }> {
  const steps: ProbeStep[] = [];
  let fts5Matched = false;
  let persisted = false;

  let db: ReturnType<typeof wrapDb>;
  try {
    const storage = await useOpfsStorage(DB_NAME, { url: WASM_URL });
    db = wrapDb(await initSQLite(storage));
    steps.push({ name: 'opfs: open (useOpfsStorage + initSQLite)', ok: true });
  } catch (e) {
    steps.push({ name: 'opfs: open (useOpfsStorage + initSQLite)', ok: false, detail: errDetail(e) });
    return { steps, fts5Matched, persisted };
  }

  try {
    await db.exec('CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY, body TEXT)');
    await db.exec('INSERT INTO probe (id, body) VALUES (1, ?)', [PROBE_BODY]);
    const rows = await db.query('SELECT body FROM probe WHERE id = 1');
    const readBack = rows[0]?.body;
    const crudOk = readBack === PROBE_BODY;
    steps.push({ name: 'opfs: insert + select', ok: crudOk, detail: crudOk ? undefined : `row body=${String(readBack)}` });

    await db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS probe_fts USING fts5(body)');
    await db.exec('INSERT INTO probe_fts (rowid, body) SELECT id, body FROM probe');
    const ftsRows = await db.query("SELECT body FROM probe_fts WHERE probe_fts MATCH 'yasumaro'");
    fts5Matched = Array.isArray(ftsRows) && ftsRows.length > 0 && ftsRows[0]?.body === PROBE_BODY;
    steps.push({ name: 'opfs: fts5 match query', ok: fts5Matched });

    await db.close();
    steps.push({ name: 'opfs: close', ok: true });
  } catch (e) {
    steps.push({ name: 'opfs: crud / fts5', ok: false, detail: errDetail(e) });
  }

  try {
    const storage2 = await useOpfsStorage(DB_NAME, { url: WASM_URL });
    const db2 = wrapDb(await initSQLite(storage2));
    const rows2 = await db2.query('SELECT body FROM probe WHERE id = 1');
    persisted = Array.isArray(rows2) && rows2[0]?.body === PROBE_BODY;
    await db2.close();
    steps.push({ name: 'opfs: reopen + persistence', ok: persisted, detail: persisted ? undefined : 'row lost after reopen' });
  } catch (e) {
    steps.push({ name: 'opfs: reopen + persistence', ok: false, detail: errDetail(e) });
  }

  return { steps, fts5Matched, persisted };
}

async function probeIdb(): Promise<{ steps: ProbeStep[]; persisted: boolean }> {
  const steps: ProbeStep[] = [];
  let persisted = false;

  let db: ReturnType<typeof wrapDb>;
  try {
    const storage = await useIdbStorage(IDB_NAME, { url: WASM_URL, lockPolicy: 'exclusive' });
    db = wrapDb(await initSQLite(storage));
    steps.push({ name: 'idb: open (useIdbStorage + initSQLite)', ok: true });
  } catch (e) {
    steps.push({ name: 'idb: open (useIdbStorage + initSQLite)', ok: false, detail: errDetail(e) });
    return { steps, persisted };
  }

  try {
    await db.exec('CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY, body TEXT)');
    await db.exec('INSERT INTO probe (id, body) VALUES (1, ?)', [PROBE_BODY]);
    const rows = await db.query('SELECT body FROM probe WHERE id = 1');
    const crudOk = rows[0]?.body === PROBE_BODY;
    steps.push({ name: 'idb: insert + select', ok: crudOk });
    await db.close();

    const storage2 = await useIdbStorage(IDB_NAME, { url: WASM_URL, lockPolicy: 'exclusive' });
    const db2 = wrapDb(await initSQLite(storage2));
    const rows2 = await db2.query('SELECT body FROM probe WHERE id = 1');
    persisted = Array.isArray(rows2) && rows2[0]?.body === PROBE_BODY;
    await db2.close();
    steps.push({ name: 'idb: reopen + persistence', ok: persisted, detail: persisted ? undefined : 'row lost after reopen' });
  } catch (e) {
    steps.push({ name: 'idb: crud / reopen', ok: false, detail: errDetail(e) });
  }

  return { steps, persisted };
}

async function main(): Promise<ProbeResult> {
  const caps = {
    opfsDirectory: typeof navigator.storage?.getDirectory === 'function',
    syncAccessHandle:
      typeof FileSystemFileHandle !== 'undefined' &&
      typeof (FileSystemFileHandle.prototype as { createSyncAccessHandle?: unknown }).createSyncAccessHandle === 'function',
  };
  const result: ProbeResult = {
    userAgent: navigator.userAgent,
    caps,
    rawSah: await probeRawSah(),
    opfs: await probeOpfs(),
    idb: await probeIdb(),
  };
  self.postMessage(result);
}

void main().catch((e) => {
  self.postMessage({ fatal: errDetail(e) } satisfies Partial<ProbeResult> & { fatal: string });
});
