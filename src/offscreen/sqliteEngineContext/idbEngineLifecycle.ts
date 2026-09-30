/**
 * idbEngineLifecycle.ts
 * Extracted from sqliteEngineContext.ts (PBI-01).
 * Handles IDB engine initialization via @subframe7536/sqlite-wasm:
 * schema creation, WAL mode, migration runner, compile options logging.
 */

import { errorMessage } from '../../utils/errorUtils.js';
import { ErrorCode } from '../../utils/logger/types.js';
import { logError } from '../../utils/logger/api.js';
import { createIdbEngine, type SqliteEngine, type SqliteRow } from '../sqliteEngine.js';
import { bootSqliteEngine } from '../sqliteBoot.js';
import { DB_FILENAME } from '../dbFilename.js';
import type { SqliteValue } from '../sqliteEngine.js';

// Re-exported, not declared: the host facade and the pre-migration backup
// still import the name from here, and the declaration belongs to
// dbFilename.ts alongside the two worker-side readers of the same file.
export { DB_FILENAME };

const IDB_WASM_URL = new URL('@subframe7536/sqlite-wasm/wasm-async', import.meta.url).href;

export interface IdbeEngineState {
  idbEngine: SqliteEngine | null;
  fts5Available: boolean;
  cachedCompileOptions: string[] | null;
  lastInitError: string | null;
}

/**
 * Initialize the IDB engine: create the engine, run the shared boot sequence
 * (pragmas, schema, migrations, compile options). Returns true on success,
 * false on failure (state.lastInitError set).
 */
export async function initIdbEngine(state: IdbeEngineState): Promise<boolean> {
  try {
    state.idbEngine = await createIdbEngine(DB_FILENAME, IDB_WASM_URL);

    const { fts5Available, compileOptions } = await bootSqliteEngine(state.idbEngine);
    state.fts5Available = fts5Available;
    state.cachedCompileOptions = compileOptions;

    return true;
  } catch (error) {
    state.lastInitError = errorMessage(error);
    logError('SQLite: init failed', { error: errorMessage(error) }, ErrorCode.STORAGE_MIGRATION_FAILURE, 'sqlite');
    state.idbEngine = null;
    return false;
  }
}

/**
 * Execute SQL against the IDB engine, invoking callback once per result row.
 */
export async function execWithCache(
  idbEngine: SqliteEngine,
  sql: string,
  params: SqliteValue[] = [],
  callback?: (row: SqliteValue[]) => void
): Promise<void> {
  if (!callback) {
    await idbEngine.exec(sql, params);
    return;
  }
  const rows = await idbEngine.query(sql, params);
  for (const row of rows) {
    callback(Object.values(row as SqliteRow) as SqliteValue[]);
  }
}
