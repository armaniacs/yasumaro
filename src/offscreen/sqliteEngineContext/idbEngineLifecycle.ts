/**
 * idbEngineLifecycle.ts
 * Extracted from sqliteEngineContext.ts (PBI-01).
 * Handles IDB engine initialization via @subframe7536/sqlite-wasm:
 * schema creation, WAL mode, migration runner, compile options logging.
 */

import { errorMessage } from '../../utils/errorUtils.js';
import { logError, ErrorCode } from '../../utils/logger.js';
import { SCHEMA_SQL, AUDIT_LOG_SCHEMA_SQL } from '../schema.js';
import { runMigrations } from '../migrations.js';
import { createIdbEngine, type SqliteEngine, type SqliteRow } from '../sqliteEngine.js';
import type { SqliteValue } from '../sqliteEngineContext.js';

export const DB_FILENAME = 'yasumaro.db';
const IDB_WASM_URL = new URL('@subframe7536/sqlite-wasm/wasm-async', import.meta.url).href;

export interface IdbeEngineState {
  idbEngine: SqliteEngine | null;
  fts5Available: boolean;
  cachedCompileOptions: string[] | null;
  lastInitError: string | null;
}

/**
 * Initialize the IDB engine: create the engine, enable WAL, run schema
 * creation, run migrations, and log compile options.
 * Returns true on success, false on failure (state.lastInitError set).
 */
export async function initIdbEngine(state: IdbeEngineState): Promise<boolean> {
  try {
    state.idbEngine = await createIdbEngine(DB_FILENAME, IDB_WASM_URL);

    // Enable WAL mode before any schema/migration operations for journal consistency
    await state.idbEngine.exec('PRAGMA journal_mode=WAL;');
    await state.idbEngine.exec('PRAGMA wal_autocheckpoint=1000;');

    // Execute schema creation
    await state.idbEngine.exec(SCHEMA_SQL);
    await state.idbEngine.exec(AUDIT_LOG_SCHEMA_SQL);

    // Run schema migrations through shared migration engine
    const idbEngine = state.idbEngine;
    const { fts5Available } = await runMigrations({
      exec: (sql) => idbEngine.exec(sql),
      queryValue: async (sql) => {
        const value = await idbEngine.queryValue(sql);
        return value != null ? Number(value) : null;
      },
    });
    state.fts5Available = fts5Available;

    // Log available extensions
    const compileOptions: string[] = [];
    const rows = await state.idbEngine.query('PRAGMA compile_options');
    for (const row of rows) {
      compileOptions.push(String(Object.values(row)[0]));
    }
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
