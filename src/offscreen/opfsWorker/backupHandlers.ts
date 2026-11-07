/**
 * backupHandlers.ts
 * Backup, restore, and serialize operations.
 */

import { errorMessage } from '../../utils/errorUtils.js';
import { sqlQuery, type HandlerContext } from './handlers.js';
import { buildExportEnvelope, EXPORT_COLUMNS } from '../exportEnvelope.js';
import { DB_FILENAME } from '../dbFilename.js';
import { createEngine } from '../sqliteBoot.js';
import { FTS5_STATEMENTS } from '../schema.js';
import { WASM_ASSET_URLS } from '../wasmAssets.js';
import type { NamedRow } from '../rowCodec.js';

const RESTORE_TMP_FILENAME = `${DB_FILENAME}.restore-tmp`;

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
 * Restore a binary .db file: write to temp file → validate as SQLite →
 * replace production file. On validation failure, temp file is discarded
 * and the production file is untouched.
 */
export async function handleRestore(
  data: Uint8Array,
  getEngine: () => import('../sqliteEngine.js').SqliteEngine | null,
  setEngine: (e: import('../sqliteEngine.js').SqliteEngine | null) => void,
  initSqlite: () => Promise<void>,
): Promise<{ restored: true }> {
  const root = await navigator.storage.getDirectory();

  // 1. Write to temp file
  const tmpHandle = await root.getFileHandle(RESTORE_TMP_FILENAME, { create: true });
  const writable = await tmpHandle.createWritable();
  // WHY: `data.slice()` returns `Uint8Array` but `FileSystemWritableFileStream.write()` accepts `ArrayBuffer` at runtime
  await writable.write(data.slice() as unknown as ArrayBuffer);
  await writable.close();

  // 2. Validate as SQLite
  try {
    const tmpEngine = await createEngine(RESTORE_TMP_FILENAME, WASM_ASSET_URLS.opfsEngineWasm);
    await tmpEngine.exec('SELECT count(*) FROM sqlite_master');
    // PBI 2026-09-06-01: an archive-format .db carries yasumaro_archive_meta
    // and must NOT be accepted by the full restore (it would overwrite the
    // main DB with an FTS-less copy). Direct users to the archive restore UI.
    const archiveRows = await tmpEngine.query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'yasumaro_archive_meta'",
    );
    if (archiveRows.length > 0) {
      await tmpEngine.close();
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
        await tmpEngine.close();
        throw new Error(`Restore validation failed: unexpected trigger '${name}'`);
      }
    }
    await tmpEngine.close();
  } catch (validationError) {
    await root.removeEntry(RESTORE_TMP_FILENAME).catch(() => {});
    throw new Error(`Restore validation failed: ${errorMessage(validationError)}`);
  }

  // 3. Close existing engine, replace file, re-init
  const currentEngine = getEngine();
  if (currentEngine) {
    await currentEngine.close();
    setEngine(null);
  }
  await root.removeEntry(DB_FILENAME).catch(() => {});
  // WHY: OPFS `FileSystemFileHandle` lacks `move()` in TypeScript types but it exists in Chromium
  await (tmpHandle as unknown as { move: (name: string) => Promise<void> }).move(DB_FILENAME);

  await initSqlite();

  return { restored: true };
}
