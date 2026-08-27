// src/offscreen/migrations.ts — Active schema migrations (NOT legacy sunset target).
//
// This file is NOT part of the wa-sqlite legacy sunset investigated in PBI 03.
// It performs idempotent `ALTER TABLE ADD COLUMN` / FTS5 / index creation that
// every existing DB must run on upgrade (MIGRATION_SEQUENCE, MIGRATION_COLUMNS,
// GIST_SYNCED_INDEX_SQL, FTS5_STATEMENTS). Removing it would break upgrades from
// any prior schema version, whereas the legacy sunset target is specifically
// `opfsMigrationV2Reader.ts` + `sqliteEngineContext/migrationBackup.ts` which
// exist only to copy data out of the pre-v6.5.34 wa-sqlite databases
// (AccessHandlePoolVFS / IDBBatchAtomicVFS). See migrationBackup.ts header for
// the 5 Whys and sunset criteria; this file stays permanently and is out of
// scope for PBI 04 WASM consolidation.
//
// Retention: KEEP indefinitely. All branches are idempotent (duplicate column /
// already exists → continue) and safe for fresh installs.

import { MIGRATION_COLUMNS, MIGRATION_SEQUENCE, FTS5_STATEMENTS, GIST_SYNCED_INDEX_SQL } from './schema.js';
import { errorMessage } from '../utils/errorUtils.js';

export interface MigrationEngine {
  exec(sql: string): Promise<void>;
  queryValue(sql: string): Promise<number | null>;
}

export async function runMigrations(engine: MigrationEngine): Promise<{ fts5Available: boolean }> {
  // 1. One-off migrations
  for (const step of MIGRATION_SEQUENCE) {
    try {
      await engine.exec(step.sql);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw err;
    }
  }

  // PBI-11: gist_synced index
  try {
    await engine.exec(GIST_SYNCED_INDEX_SQL);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('already exists')) {
      // Index already exists — ignore
    } else {
      throw err;
    }
  }

  // 2. ALTER TABLE migration for all dynamic columns
  for (const colDef of MIGRATION_COLUMNS) {
    try {
      await engine.exec(`ALTER TABLE browsing_logs ADD COLUMN ${colDef}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('duplicate column name')) continue;
      throw err;
    }
  }

  // 3. FTS5 schema
  let fts5Available = false;
  try {
    for (const stmt of FTS5_STATEMENTS) {
      await engine.exec(stmt);
    }
    fts5Available = true;
  } catch (err) {
    console.warn('FTS5 unavailable:', errorMessage(err));
  }

  // 4. FTS index rebuild
  if (fts5Available) {
    try {
      const baseCount = Number(await engine.queryValue('SELECT COUNT(*) AS c FROM browsing_logs') ?? 0);
      const ftsCount = Number(await engine.queryValue('SELECT COUNT(*) AS c FROM browsing_logs_fts') ?? 0);
      if (baseCount > 0 && ftsCount === 0) {
        await engine.exec("INSERT INTO browsing_logs_fts(browsing_logs_fts) VALUES('rebuild')");
      }
    } catch (rebuildErr) {
      console.warn('FTS rebuild check failed:', errorMessage(rebuildErr));
    }
  }

  return { fts5Available };
}
