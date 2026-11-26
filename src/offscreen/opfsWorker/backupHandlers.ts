/**
 * backupHandlers.ts
 * Backup and serialize operations. The former single-shot binary restore
 * lived here too and was removed (PBI 2026-11-26-14) — the chunked restore
 * staging session (restoreStagingHandlers.ts) is the only restore path.
 */

import { sqlQuery, type HandlerContext } from './handlers.js';
import { buildExportEnvelope, EXPORT_COLUMNS } from '../exportEnvelope.js';
import { DB_FILENAME } from '../dbFilename.js';
import { createEngine } from '../sqliteBoot.js';
import { FTS5_STATEMENTS } from '../schema.js';
import { WASM_ASSET_URLS } from '../wasmAssets.js';
import type { NamedRow } from '../rowCodec.js';

/**
 * Whitespace-normalized form for trigger SQL comparison. sqlite_master
 * stores the CREATE statement text as executed, with two normalizations
 * applied by SQLite itself: `IF NOT EXISTS` is dropped, and formatting may
 * drift between versions. Both sides go through this function so a genuine
 * backup always matches the schema SSOT.
 */
function normalizeTriggerSql(sql: string): string {
  return sql
    .replace(/\bIF NOT EXISTS\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * yasumaro's own FTS5 sync triggers (name → normalized CREATE statement),
 * derived from the schema SSOT. A genuine backup always carries these —
 * the live DB file is exported verbatim — so the restore validator must
 * accept them. Anything else is untrusted backup content and stays rejected.
 */
function expectedTriggerSql(): Map<string, string> {
  const expected = new Map<string, string>();
  for (const statement of FTS5_STATEMENTS) {
    const match = /CREATE TRIGGER IF NOT EXISTS\s+([A-Za-z_]\w*)/i.exec(statement);
    if (match?.[1]) expected.set(match[1], normalizeTriggerSql(statement));
  }
  return expected;
}

export async function handleSerialize(ctx: HandlerContext): Promise<Uint8Array> {
  // PBI 2026-09-12-22: rows go through the shared envelope + column SSOT
  // (was a bare-array JSON over 13 hand-mapped columns with 6 `as` casts
  // outside rowCodec — a different export schema than IDB/fallback).
  const rows: NamedRow[] = [];
  await sqlQuery(
    ctx,
    `SELECT ${EXPORT_COLUMNS.join(', ')}
     FROM browsing_logs WHERE is_deleted = 0 ORDER BY created_at DESC`,
    [],
    (row) => {
      rows.push(row as NamedRow);
    }
  );

  return buildExportEnvelope(rows);
}

/**
 * Binary .db backup — reads the OPFS file directly via getFile().
 * Cannot use createSyncAccessHandle because OPFSCoopSyncVFS already holds
 * the file open (INVALID_STATE).
 */
export async function handleBackup(ctx: HandlerContext): Promise<Uint8Array> {
  // WAL checkpoint flushes all data to the main .db file
  try {
    await ctx.engine.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {
    // Non-WAL mode — ignore
  }

  const root = await navigator.storage.getDirectory();
  const fileHandle = await root.getFileHandle(DB_FILENAME, { create: false });
  const file = await fileHandle.getFile();
  const buffer = await file.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Validate an OPFS file as a genuine full-backup SQLite DB (not an archive
 * container): openable, has a sqlite_master, carries no yasumaro_archive_meta
 * (that means "use the archive restore panel"), and every trigger matches the
 * schema's own sync triggers byte-for-byte (modulo whitespace). Used by the
 * chunked restore commit (staging file) before the destructive swap.
 * Throws on the first failure; the caller owns cleanup of the file.
 */
export async function validateFullBackupFile(fileName: string): Promise<void> {
  const tmpEngine = await createEngine(fileName, WASM_ASSET_URLS.opfsEngineWasm);
  try {
    await tmpEngine.exec('SELECT count(*) FROM sqlite_master');
    // An archive-format .db carries yasumaro_archive_meta and must NOT be
    // accepted by the full restore (it would overwrite the main DB with an
    // FTS-less copy). Direct users to the archive restore UI.
    const archiveRows = await tmpEngine.query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'yasumaro_archive_meta'",
    );
    if (archiveRows.length > 0) {
      throw new Error(
        'Archive database detected: use the archive restore panel (archive_restore) instead of full restore_db',
      );
    }
    const triggerRows = await tmpEngine.query(
      "SELECT name, sql FROM sqlite_master WHERE type = 'trigger'",
    );
    // WHY allowlist by exact SQL, not just name: a crafted backup file could
    // reuse a trusted trigger name with hostile SQL. Only byte-identical
    // (modulo whitespace) copies of the schema's own sync triggers pass.
    const expected = expectedTriggerSql();
    for (const row of triggerRows) {
      const name = String(row.name ?? '');
      const sql = normalizeTriggerSql(String(row.sql ?? ''));
      if (expected.get(name) !== sql) {
        throw new Error(`Restore validation failed: unexpected trigger '${name}'`);
      }
    }
  } finally {
    await tmpEngine.close();
  }
}
