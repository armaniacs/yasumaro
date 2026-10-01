/**
 * sqliteBoot.ts — the boot sequence both VFS backends run, in one place.
 *
 * The OPFS worker and the IDB VFS engine differ only in their VFS; opening the
 * database was still written twice, and the copies had drifted: only the IDB
 * side set `wal_autocheckpoint`, and the two migration adapters disagreed on
 * what a `null` queryValue means. A missing pragma or a null-coalescing
 * difference is invisible until it costs WAL growth or a migration probe.
 *
 * PBI-05: the engine generation seams (createEngine/createIdbEngine and the
 * wasmUrlOverride registration) live here too — this module is the single
 * place that creates and boots an engine for either VFS.
 *
 * What stays at the call sites, deliberately: each backend's own error
 * policy (the IDB lifecycle records `lastInitError` and returns false, the
 * worker rethrows after nulling the engine) and the migrations that are
 * specific to one engine (the pre-migration backup/restore around the IDB open,
 * the AccessHandlePoolV2 sweep after the worker's).
 */

import { initSQLite } from '@subframe7536/sqlite-wasm';
import { useOpfsStorage } from '@subframe7536/sqlite-wasm/opfs';
import { useIdbStorage } from '@subframe7536/sqlite-wasm/idb';
import { AUDIT_LOG_SCHEMA_SQL, SCHEMA_SQL } from './schema.js';
import { runMigrations, type MigrationEngine } from './migrations.js';
import type { SqliteEngine, SqliteRow, SqliteValue } from './sqliteEngine.js';

/**
 * Executed in this exact order, before any schema or migration statement.
 * WAL must be established first so every later write is journalled the same
 * way; the checkpoint threshold then bounds how large the WAL can get between
 * checkpoints instead of falling back to the SQLite default.
 */
export const BOOT_PRAGMAS: readonly string[] = [
  'PRAGMA journal_mode=WAL;',
  'PRAGMA wal_autocheckpoint=1000;',
];

/** Schema statements, in dependency order (browsing_logs, then audit_log). */
export const BOOT_SCHEMA_SQL: readonly string[] = [SCHEMA_SQL, AUDIT_LOG_SCHEMA_SQL];

/**
 * Adapt a raw engine to the migration runner.
 *
 * One definition, because the two hand-written adapters disagreed: `null` is
 * what `queryValue` returns for a statement that yields no row, and both must
 * map it to "no value" rather than letting it reach the arithmetic in
 * runMigrations (a `Number(null)` read as a present 0).
 */
export function createMigrationEngine(engine: SqliteEngine): MigrationEngine {
  return {
    exec: (sql) => engine.exec(sql),
    queryValue: async (sql) => {
      const value = await engine.queryValue(sql);
      return value != null ? Number(value) : null;
    },
  };
}

/** Read `PRAGMA compile_options` into the flat string list both call sites store. */
async function readCompileOptions(engine: SqliteEngine): Promise<string[]> {
  const rows = await engine.query('PRAGMA compile_options');
  return rows.map((row) => String(Object.values(row)[0] ?? ''));
}

// ============================================================================
// Engine generation (PBI-05: the single generation seam for either VFS)
// ============================================================================

/**
 * SQLiteCompatibleType mirrors wa-sqlite's definition; align our param/row
 * types to the library's run() signature.
 */
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
      if (!firstRow) return null;
      const firstKey = Object.keys(firstRow)[0];
      return firstKey !== undefined ? (firstRow[firstKey] ?? null) : null;
    },

    async close(): Promise<void> {
      await db.close();
    },
  };
}

/**
 * Explicit wasm URL override (Firefox only). The bundler inlines `new URL()`
 * asset references in some entry builds (unlisted worker, background), and an
 * inlined data: URL cannot be fetched under the extension CSP
 * (connect-src 'self') — the worker then dies with NetworkError. The
 * container (background event page on Firefox) points this at the stable
 * public asset (wasm/wa-sqlite-async.wasm, copied by the build) so both the
 * in-page engines and the worker (via the INIT payload) load the wasm from a
 * same-origin file URL. Never set on Chromium: the bundled asset URLs there
 * are valid files.
 */
let wasmUrlOverride: string | null = null;

export function setSqliteWasmUrlOverride(url: string | null): void {
  wasmUrlOverride = url;
}

export function getSqliteWasmUrlOverride(): string | null {
  return wasmUrlOverride;
}

export async function createEngine(dbPath: string, wasmUrl: string): Promise<SqliteEngine> {
  const storage = await useOpfsStorage(dbPath, { url: wasmUrlOverride ?? wasmUrl });
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
  const storage = await useIdbStorage(dbFileName, { url: wasmUrlOverride ?? wasmUrl, lockPolicy: 'exclusive' });
  const db = await initSQLite(storage);
  return wrapDb(db);
}

/**
 * Open-time work shared by both backends: pragmas → schema → migrations →
 * compile options. Returns what the caller stores on its own engine state;
 * the engine itself is supplied already-created because each backend builds
 * its own (OPFS worker vs IDB VFS) and needs the instance kept alive.
 */
export async function bootSqliteEngine(engine: SqliteEngine): Promise<{
  fts5Available: boolean;
  compileOptions: string[];
}> {
  for (const pragma of BOOT_PRAGMAS) {
    await engine.exec(pragma);
  }
  for (const sql of BOOT_SCHEMA_SQL) {
    await engine.exec(sql);
  }
  const { fts5Available } = await runMigrations(createMigrationEngine(engine));
  return { fts5Available, compileOptions: await readCompileOptions(engine) };
}
