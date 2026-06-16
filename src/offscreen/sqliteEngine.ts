import { initSQLite } from '@subframe7536/sqlite-wasm';
import { useOpfsStorage } from '@subframe7536/sqlite-wasm/opfs';

// SQLiteCompatibleType mirrors wa-sqlite's definition
export type SqliteValue = number | string | Uint8Array | number[] | bigint | null;
export type SqliteRow = Record<string, SqliteValue>;

export interface SqliteEngine {
  exec(sql: string, params?: SqliteValue[]): Promise<void>;
  query(sql: string, params?: SqliteValue[]): Promise<SqliteRow[]>;
  queryValue(sql: string, params?: SqliteValue[]): Promise<SqliteValue>;
  close(): Promise<void>;
}

export async function createEngine(dbPath: string, wasmUrl: string): Promise<SqliteEngine> {
  const storage = await useOpfsStorage(dbPath, { url: wasmUrl });
  const db = await initSQLite(storage);

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
