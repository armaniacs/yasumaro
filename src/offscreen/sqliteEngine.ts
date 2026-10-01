// SQLiteCompatibleType mirrors wa-sqlite's definition
export type SqliteValue = number | string | Uint8Array | number[] | bigint | null;
export type SqliteRow = Record<string, SqliteValue>;

export interface SqliteEngine {
  exec(sql: string, params?: SqliteValue[]): Promise<void>;
  query(sql: string, params?: SqliteValue[]): Promise<SqliteRow[]>;
  queryValue(sql: string, params?: SqliteValue[]): Promise<SqliteValue>;
  close(): Promise<void>;
}

// PBI-05: the engine generation seams (wrapDb, the wasm URL override, and the
// per-VFS create functions) live in sqliteBoot.ts — the single generation and
// boot seam. This module keeps the shared engine types; the re-export keeps
// the sqliteEngine.js import path working for the wrapDb boundary test suite.
export {
  createEngine,
  createIdbEngine,
  setSqliteWasmUrlOverride,
  getSqliteWasmUrlOverride,
} from './sqliteBoot.js';
