import { initSQLite } from '@subframe7536/sqlite-wasm';
import { useOpfsStorage } from '@subframe7536/sqlite-wasm/opfs';
import { useIdbStorage } from '@subframe7536/sqlite-wasm/idb';

// SQLiteCompatibleType mirrors wa-sqlite's definition
export type SqliteValue = number | string | Uint8Array | number[] | bigint | null;
export type SqliteRow = Record<string, SqliteValue>;

export interface SqliteEngine {
  exec(sql: string, params?: SqliteValue[]): Promise<void>;
  query(sql: string, params?: SqliteValue[]): Promise<SqliteRow[]>;
  queryValue(sql: string, params?: SqliteValue[]): Promise<SqliteValue>;
  close(): Promise<void>;
}

function wrapDb(db: { run: (sql: string, params?: SqliteValue[]) => Promise<SqliteRow[]>; close: () => Promise<void> }): SqliteEngine {
  // The library's run() uses SQLiteCompatibleType[] for params and returns
  // Array<Record<string, SQLiteCompatibleType>>. We align our types to match.
  const runFn = db.run as (sql: string, params?: SqliteValue[]) => Promise<SqliteRow[]>;

  return {
    async exec(sql: string, params?: SqliteValue[]): Promise<void> {
      await runFn(sql, params);
    },

    async query(sql: string, params?: SqliteValue[]): Promise<SqliteRow[]> {
      return runFn(sql, params);
    },

    async queryValue(sql: string, params?: SqliteValue[]): Promise<SqliteValue> {
      const rows = await runFn(sql, params);
      if (rows.length === 0) {
        return null;
      }
      const firstRow = rows[0];
      const firstKey = Object.keys(firstRow)[0];
      return firstKey !== undefined ? firstRow[firstKey] : null;
    },

    async close(): Promise<void> {
      await db.close();
    },
  };
}

export async function createEngine(dbPath: string, wasmUrl: string): Promise<SqliteEngine> {
  const storage = await useOpfsStorage(dbPath, { url: wasmUrl });
  const db = await initSQLite(storage);
  return wrapDb(db);
}

/**
 * Create an engine backed by @subframe7536/sqlite-wasm's IndexedDB VFS
 * (IDBBatchAtomicVFS, ported from wa-sqlite/src/examples/IDBBatchAtomicVFS.js).
 *
 * IMPORTANT: useIdbStorage(fileName, options) ignores options.idbName — the
 * IndexedDB *database* name is always derived from fileName (with a forced
 * `.db` suffix), not settable independently. This means the SQLite virtual
 * file path and the IndexedDB database name are the same value; there is no
 * way to keep them distinct as the old wa-sqlite setup did (VFS_NAME vs
 * DB_FILENAME). Migrating an existing wa-sqlite IDB database requires using
 * DB_FILENAME as the IndexedDB database name too (see E2E spike notes in
 * PBI 2026-07-16-06).
 */
export async function createIdbEngine(dbFileName: string, wasmUrl: string): Promise<SqliteEngine> {
  const storage = await useIdbStorage(dbFileName, { url: wasmUrl, lockPolicy: 'exclusive' });
  const db = await initSQLite(storage);
  return wrapDb(db);
}
