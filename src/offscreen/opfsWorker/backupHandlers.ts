/**
 * backupHandlers.ts
 * Backup, restore, and serialize operations.
 */

import type { BrowsingLogRecord } from '../../utils/sqlite-types.js';
import { errorMessage } from '../../utils/errorUtils.js';
import { sqlQuery } from './handlers.js';
import type { HandlerContext } from './handlers.js';

const DB_FILENAME = 'yasumaro.db';
const WASM_URL = new URL('@subframe7536/sqlite-wasm/wasm', import.meta.url).href;
const RESTORE_TMP_FILENAME = `${DB_FILENAME}.restore-tmp`;

export async function handleSerialize(ctx: HandlerContext): Promise<Uint8Array> {
  const rows: BrowsingLogRecord[] = [];
  await sqlQuery(
    ctx,
    `SELECT id, url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred, is_deleted, obsidian_synced, gist_synced
     FROM browsing_logs WHERE is_deleted = 0 ORDER BY created_at DESC`,
    [],
    (row) => {
      rows.push({
        id: Number(row.id),
        url: String(row.url),
        title: row.title as string | null,
        summary: row.summary as string | null,
        tags: row.tags as string | null,
        created_at: Number(row.created_at),
        domain: row.domain as string | null,
        visit_duration: row.visit_duration as number | null,
        scroll_ratio: row.scroll_ratio as number | null,
        is_starred: Number(row.is_starred),
        is_deleted: Number(row.is_deleted),
        obsidian_synced: Number(row.obsidian_synced),
        gist_synced: Number(row.gist_synced),
      });
    }
  );

  const encoder = new TextEncoder();
  return encoder.encode(JSON.stringify(rows));
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
  const { createEngine } = await import('../sqliteEngine.js');
  const root = await navigator.storage.getDirectory();

  // 1. Write to temp file
  const tmpHandle = await root.getFileHandle(RESTORE_TMP_FILENAME, { create: true });
  const writable = await tmpHandle.createWritable();
  // WHY: `data.slice()` returns `Uint8Array` but `FileSystemWritableFileStream.write()` accepts `ArrayBuffer` at runtime
  await writable.write(data.slice() as unknown as ArrayBuffer);
  await writable.close();

  // 2. Validate as SQLite
  try {
    const tmpEngine = await createEngine(RESTORE_TMP_FILENAME, WASM_URL);
    await tmpEngine.exec('SELECT count(*) FROM sqlite_master');
    const triggerRows = await tmpEngine.query('SELECT count(*) as c FROM sqlite_master WHERE type = \'trigger\'');
    const triggerCount = Number(triggerRows[0]?.c ?? 0);
    if (triggerCount > 0) {
      await tmpEngine.close();
      throw new Error(`Restore validation failed: trigger detected (${triggerCount})`);
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
