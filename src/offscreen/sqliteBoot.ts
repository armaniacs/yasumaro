/**
 * sqliteBoot.ts — the boot sequence both VFS backends run, in one place.
 *
 * The OPFS worker and the IDB VFS engine differ only in their VFS; opening the
 * database was still written twice, and the copies had drifted: only the IDB
 * side set `wal_autocheckpoint`, and the two migration adapters disagreed on
 * what a `null` queryValue means. A missing pragma or a null-coalescing
 * difference is invisible until it costs WAL growth or a migration probe.
 *
 * What stays at the call sites, deliberately: each backend's own error
 * policy (the IDB lifecycle records `lastInitError` and returns false, the
 * worker rethrows after nulling the engine) and the migrations that are
 * specific to one engine (the pre-migration backup/restore around the IDB open,
 * the AccessHandlePoolV2 sweep after the worker's).
 */

import { AUDIT_LOG_SCHEMA_SQL, SCHEMA_SQL } from './schema.js';
import { runMigrations, type MigrationEngine } from './migrations.js';
import type { SqliteEngine } from './sqliteEngine.js';

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
