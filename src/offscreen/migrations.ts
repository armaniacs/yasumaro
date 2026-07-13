// src/offscreen/migrations.ts
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
    } catch {
      // Column/target already exists — ignore
    }
  }

  // PBI-11: gist_synced index
  try {
    await engine.exec(GIST_SYNCED_INDEX_SQL);
  } catch {
    // Index already exists
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
