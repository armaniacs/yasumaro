/**
 * migrationBackup.ts — Legacy wa-sqlite IDBBatchAtomicVFS → @subframe7536 IDB VFS migration.
 *
 * Extracted from sqliteEngineContext.ts (PBI-01).
 * Handles backup of old IDB data, restore on mismatch, and completion flag management.
 *
 * ## Retention rationale (PBI 03: investigate-legacy-migration-sunset — 2026-08-27)
 *
 * This module is intentionally RETAINED as of 2026-08-27. It must not be removed yet.
 *
 * ### 5 Whys — why removal is unsafe now
 * 1. Why would removal cause data loss? → Users who still have the old IndexedDB
 *    database `idb-batch-atomic` (wa-sqlite) would lose all browsing_logs rows:
 *    the new engine opens `yasumaro.db` under @subframe7536, which is a different
 *    IndexedDB database name; without this backup/restore, old rows are invisible.
 * 2. Why might such users still exist? → Migration was introduced in v6.5.34
 *    (2026-07-17); as of 2026-08-27 only ~40 days have elapsed. Chrome auto-update
 *    is not instantaneous and infrequent users / disabled-extension users lag.
 * 3. Why can't we measure how many remain? → No telemetry is collected by design
 *    (docs/PRIVACY.md: all browsing data stays local). There is no anonymous
 *    aggregate of `idb_migration_v2_done` adoption.
 * 4. Why can't we decide without measurement? → The only local signal (PBI 02:
 *    diagnostics panel showing OPFS/IDB migration status) was just shipped
 *    (v6.7.82) and has had zero operating period to collect support reports.
 * 5. Why does that force retention? → ADR-014 and PBI 2026-07-16-07 mandate a
 *    6-month retention (re-evaluate 2026-12-17) before sunset; deleting now would
 *    violate that decision and risk silent data loss for an unmeasurable cohort.
 *
 * ### Sunset criteria (acceptance criteria for PBI 03)
 * - Criterion: earliest re-evaluation date is 2026-12-17 (6 months from v6.5.34).
 *   Additionally, DiagnosticsCollector/PBI-02 must have been in production for
 *   several months with zero "Not completed" reports via support/Issues that
 *   correspond to genuine legacy DBs (fresh installs intentionally show "Not
 *   completed" and do not count).
 * - If criteria met: remove this file, remove the wa-sqlite dynamic imports
 *   (`wa-sqlite/dist/wa-sqlite-async.mjs`, `wa-sqlite/src/examples/IDBBatchAtomicVFS.js`),
 *   remove StorageKeys.IDB_MIGRATION_V2_DONE / IDB_MIGRATION_BACKUP if no longer
 *   read, and proceed to PBI 04 (consolidate WASM bundles — ~2.7 MB reduction).
 *   Also remove the companion legacy path `src/offscreen/opfsMigrationV2Reader.ts`
 *   + `src/offscreen/opfsMigrationV2.ts` under the same gate and delete the
 *   `wa-sqlite` dependency from package.json if both paths are sunset.
 * - If criteria NOT met (genuine uncompleted users still surface): defer sunset,
 *   publish an in-extension notice (diagnostics panel + release notes) that a
 *   future version will require an update before a cutoff date, and re-evaluate
 *   after another fixed window (e.g. +3 months).
 *
 * ### Operational notes
 * - Idempotent and safe for fresh installs: when `idb-batch-atomic` is absent,
 *   the module immediately marks migration done and becomes a no-op.
 * - Backup is a JSON snapshot in chrome.storage.local (IDB_MIGRATION_BACKUP);
 *   restore uses INSERT OR IGNORE so it never duplicates.
 * - `wa-sqlite` is loaded only via dynamic import when an old DB is detected, so
 *   it does not inflate the hot path; bundle cost is deferred to PBI 04.
 */

import { errorMessage } from '../../utils/errorUtils.js';
import { logError, logInfo, logWarn, ErrorCode } from '../../utils/logger.js';
import { INSERT_IGNORE_SQL, buildInsertParams, COLUMN_NAMES } from '../schema.js';
import type { BrowsingLogRecord } from '../../utils/sqlite-types.js';
import type { SqliteValue } from '../sqliteEngine.js';
import type { SqliteEngine } from '../sqliteEngine.js';
import { StorageKeys } from '../../utils/storage/types.js';
import { execWithCache, DB_FILENAME } from './idbEngineLifecycle.js';
import { extractDomain } from '../../utils/domainUtils.js';

/** Columns selected by the pre-migration backup / post-migration restore, in order. */
const MIGRATION_BACKUP_COLUMNS = [...COLUMN_NAMES];

function mapMigrationBackupRow(row: SqliteValue[]): BrowsingLogRecord {
  const idx = (name: typeof COLUMN_NAMES[number]) => COLUMN_NAMES.indexOf(name);
  const getString = (name: typeof COLUMN_NAMES[number]): string | null => {
    const v = row[idx(name)];
    return v != null ? String(v) : null;
  };
  const getNumber = (name: typeof COLUMN_NAMES[number]): number | null => {
    const v = row[idx(name)];
    return v != null ? Number(v) : null;
  };
  const getInt = (name: typeof COLUMN_NAMES[number]): number => {
    const v = row[idx(name)];
    return v != null ? Number(v) : 0;
  };
  return {
    url: String(row[idx('url')]),
    title: getString('title'),
    summary: getString('summary'),
    tags: getString('tags'),
    created_at: Number(row[idx('created_at')]),
    domain: getString('domain'),
    visit_duration: getNumber('visit_duration'),
    scroll_ratio: getNumber('scroll_ratio'),
    is_starred: getInt('is_starred'),
    is_deleted: getInt('is_deleted'),
    obsidian_synced: getInt('obsidian_synced'),
    gist_synced: getInt('gist_synced'),
    content: getString('content'),
    masked_count: getNumber('masked_count'),
    cleansed_reason: getString('cleansed_reason'),
    ai_provider: getString('ai_provider'),
    ai_model: getString('ai_model'),
    ai_duration_ms: getNumber('ai_duration_ms'),
    obsidian_duration_ms: getNumber('obsidian_duration_ms'),
    sent_tokens: getNumber('sent_tokens'),
    received_tokens: getNumber('received_tokens'),
    original_tokens: getNumber('original_tokens'),
    cleansed_tokens: getNumber('cleansed_tokens'),
    page_bytes: getNumber('page_bytes'),
    candidate_bytes: getNumber('candidate_bytes'),
    original_bytes: getNumber('original_bytes'),
    cleansed_bytes: getNumber('cleansed_bytes'),
    ai_summary_original_bytes: getNumber('ai_summary_original_bytes'),
    ai_summary_cleansed_bytes: getNumber('ai_summary_cleansed_bytes'),
    extracted_sentences_bytes: getNumber('extracted_sentences_bytes'),
    extracted_sentences_original_bytes: getNumber('extracted_sentences_original_bytes'),
    fallback_triggered: getInt('fallback_triggered'),
  };
}

interface MigrationBackupPayload {
  version: 1;
  createdAt: number;
  records: BrowsingLogRecord[];
}

export interface MigrationBackupState {
  idbEngine: SqliteEngine | null;
}

export { extractDomain } from '../../utils/domainUtils.js';

/**
 * Detect a pre-existing wa-sqlite IndexedDB database and back its records
 * up to chrome.storage.local before the new engine opens DB_FILENAME.
 */
export async function runMigrationBackup(_state: MigrationBackupState): Promise<void> {
  const OLD_IDB_NAME = 'idb-batch-atomic';
  try {
    const done = await isIdbMigrationDone();
    if (done) return;

    const databases = await indexedDB.databases?.() ?? [];
    const oldDbExists = databases.some((d) => d.name === OLD_IDB_NAME);
    if (!oldDbExists) {
      await setIdbMigrationDone();
      return;
    }

    await backupOldWaSqliteIdb(OLD_IDB_NAME);
  } catch (error) {
    logWarn(
      'SQLite: IDB migration pre-check failed, proceeding without backup',
      { error: errorMessage(error) },
      ErrorCode.STORAGE_MIGRATION_FAILURE,
      'sqlite'
    );
  }
}

async function isIdbMigrationDone(): Promise<boolean> {
  try {
    const items = await chrome.storage.local.get(StorageKeys.IDB_MIGRATION_V2_DONE);
    return items[StorageKeys.IDB_MIGRATION_V2_DONE] === true;
  } catch {
    return false;
  }
}

async function setIdbMigrationDone(): Promise<void> {
  try { await chrome.storage.local.set({ [StorageKeys.IDB_MIGRATION_V2_DONE]: true }); } catch { /* offscreen context */ }
}

/**
 * Read all records from the old wa-sqlite IDBBatchAtomicVFS database and
 * save them to chrome.storage.local as a JSON snapshot.
 */
async function backupOldWaSqliteIdb(oldIdbName: string): Promise<void> {
  const [{ default: SQLiteESMFactory }, SQLite, { IDBBatchAtomicVFS }] = await Promise.all([
    import('wa-sqlite/dist/wa-sqlite-async.mjs'),
    import('wa-sqlite'),
    import('wa-sqlite/src/examples/IDBBatchAtomicVFS.js'),
  ]);

  const asyncModule = await SQLiteESMFactory();
  if (!asyncModule.registerVFS && typeof asyncModule.vfs_register === 'function') {
    asyncModule.registerVFS = asyncModule.vfs_register;
  }
  const sqlite3 = SQLite.Factory(asyncModule);
  const vfs = new IDBBatchAtomicVFS(oldIdbName);
  if (typeof (vfs as { hasAsyncMethod?: unknown }).hasAsyncMethod !== 'function') {
    // WHY: IDBBatchAtomicVFS `hasAsyncMethod` not in TypeScript types; patched at runtime for compatibility
    (vfs as unknown as { hasAsyncMethod: (m: string) => boolean }).hasAsyncMethod = () => false;
  }
  // WHY: wa-sqlite VFS type mismatch between IDBBatchAtomicVFS and SQLiteVFS interface
  sqlite3.vfs_register(vfs as unknown as SQLiteVFS, true);

  let dbHandle: number | null = null;
  try {
    dbHandle = await sqlite3.open_v2(
      DB_FILENAME,
      SQLite.SQLITE_OPEN_READWRITE,
      oldIdbName
    );

    const records: BrowsingLogRecord[] = [];
    await sqlite3.exec(
      dbHandle,
      `SELECT ${MIGRATION_BACKUP_COLUMNS.join(', ')} FROM browsing_logs`,
      (row) => {
        records.push(mapMigrationBackupRow(row));
      }
    );

    const payload: MigrationBackupPayload = { version: 1, createdAt: Date.now(), records };
    await chrome.storage.local.set({ [StorageKeys.IDB_MIGRATION_BACKUP]: JSON.stringify(payload) });
    logInfo(
      `SQLite: backed up ${records.length} records before IDB engine migration`,
      { count: records.length },
      'sqlite'
    );
  } finally {
    if (dbHandle !== null) {
      await sqlite3.close(dbHandle).catch(() => {});
    }
    // Critical: the old VFS's IndexedDB connection MUST be closed, or the
    // new engine's indexedDB.open(DB_FILENAME, N) upgrade below hangs
    // indefinitely (verified in the E2E spike for this PBI).
    // WHY: IDBBatchAtomicVFS `close()` not in TypeScript types; must close old IDB to prevent migration hang
    await (vfs as unknown as { close: () => Promise<void> }).close().catch(() => {});
  }
}

/**
 * After the new IDB engine has initialized, verify the migration by
 * comparing record counts against the pre-migration backup.
 */
export async function runMigrationRestore(state: MigrationBackupState): Promise<void> {
  let backupJson: string | undefined;
  try {
    const items = await chrome.storage.local.get(StorageKeys.IDB_MIGRATION_BACKUP);
    const value = items[StorageKeys.IDB_MIGRATION_BACKUP];
    backupJson = typeof value === 'string' ? value : undefined;
  } catch {
    return;
  }
  if (!backupJson) {
    await setIdbMigrationDone();
    return;
  }

  try {
    const payload = JSON.parse(backupJson) as MigrationBackupPayload;
    const expectedCount = payload.records.length;

    let actualCount = 0;
    await execWithCache(state.idbEngine!, 'SELECT COUNT(*) FROM browsing_logs', [], (row) => { actualCount = Number(row[0]); });

    if (actualCount >= expectedCount && expectedCount > 0) {
      // Migration succeeded — safe to discard the backup.
      await chrome.storage.local.remove(StorageKeys.IDB_MIGRATION_BACKUP);
      await setIdbMigrationDone();
      logInfo('SQLite: IDB migration verified, backup cleared', { expectedCount, actualCount }, 'sqlite');
      return;
    }

    // Mismatch: restore from backup via idempotent INSERT OR IGNORE.
    let restored = 0;
    for (const record of payload.records) {
      try {
        const domain = record.domain || extractDomain(record.url);
        await execWithCache(state.idbEngine!, INSERT_IGNORE_SQL, buildInsertParams(record, domain));
        restored++;
      } catch {
        // Skip rows that fail to insert; do not abort the whole restore.
      }
    }
    logWarn(
      'SQLite: IDB migration record count mismatch, restored from backup',
      { expectedCount, actualCount, restored },
      ErrorCode.MIGRATION_ROLLBACK_FAILED,
      'sqlite'
    );
  } catch (error) {
    logError(
      'SQLite: failed to process IDB migration backup',
      { error: errorMessage(error) },
      ErrorCode.MIGRATION_ROLLBACK_FAILED,
      'sqlite'
    );
  }
}
