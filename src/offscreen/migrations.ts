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

/**
 * Tolerated idempotent-DDL error messages (SQLite WASM English wording),
 * kept as a defensive fallback only — the primary idempotency check is the
 * pre-execution existence probe (pragma_table_info) below, which does not
 * depend on error wording at all. Exported and test-pinned so a future
 * SQLite build's wording change is caught by tests, not by users
 * (PBI 2026-09-05-07).
 */
export const IDEMPOTENT_DDL_ERROR_PATTERNS: readonly RegExp[] = [
  /duplicate column name/i,
  /already exists/i,
];

export function isIdempotentDdlError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return IDEMPOTENT_DDL_ERROR_PATTERNS.some((p) => p.test(msg));
}

async function columnExists(engine: MigrationEngine, columnName: string): Promise<boolean> {
  const count = await engine.queryValue(
    `SELECT COUNT(*) AS c FROM pragma_table_info('browsing_logs') WHERE name = '${columnName}'`
  );
  return Number(count ?? 0) > 0;
}

export async function runMigrations(engine: MigrationEngine): Promise<{ fts5Available: boolean }> {
  // 1. One-off migrations
  // step.id は対象列名と一致する（schema.ts の MIGRATION_SEQUENCE 契約）。
  // 先に存在確認してから ALTER するため、SQLite のエラーメッセージ文言に
  // 冪等判定を依存しない。文字列マッチは競合時の防御的フォールバック。
  for (const step of MIGRATION_SEQUENCE) {
    if (await columnExists(engine, step.id)) continue;
    try {
      await engine.exec(step.sql);
    } catch (err) {
      if (isIdempotentDdlError(err)) continue;
      throw err;
    }
  }

  // PBI-11: gist_synced index
  // GIST_SYNCED_INDEX_SQL は IF NOT EXISTS 付きのため通常は成功する。
  // catch は防御的経路（文言非依存の定数パターンで判定）。
  try {
    await engine.exec(GIST_SYNCED_INDEX_SQL);
  } catch (err) {
    if (!isIdempotentDdlError(err)) {
      throw err;
    }
  }

  // 2. ALTER TABLE migration for all dynamic columns
  // 列名は colDef の先頭トークン（schema.ts の MIGRATION_COLUMNS 契約）。
  for (const colDef of MIGRATION_COLUMNS) {
    const columnName = colDef.trim().split(/\s+/)[0] ?? '';
    if (columnName.length > 0 && (await columnExists(engine, columnName))) continue;
    try {
      await engine.exec(`ALTER TABLE browsing_logs ADD COLUMN ${colDef}`);
    } catch (err) {
      if (isIdempotentDdlError(err)) continue;
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
  // 全空（ftsCount === 0）だけでなく部分投入（0 < ftsCount < baseCount）も
  // 修復対象 — 再構築の中断で恒久的に検索が不完全になるのを防ぐ（PBI 2026-09-05-06）。
  if (fts5Available) {
    try {
      const baseCount = Number(await engine.queryValue('SELECT COUNT(*) AS c FROM browsing_logs') ?? 0);
      const ftsCount = Number(await engine.queryValue('SELECT COUNT(*) AS c FROM browsing_logs_fts') ?? 0);
      if (baseCount > 0 && ftsCount < baseCount) {
        await engine.exec("INSERT INTO browsing_logs_fts(browsing_logs_fts) VALUES('rebuild')");
      }
    } catch (rebuildErr) {
      console.warn('FTS rebuild check failed:', errorMessage(rebuildErr));
    }
  }

  return { fts5Available };
}
