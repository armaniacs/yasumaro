/**
 * fallbackMigration.ts
 * Extracted from sqliteEngineContext.ts (PBI-01).
 * Handles migration of records from FallbackStorage (chrome.storage.local)
 * to the IDB-backed SQLite database.
 * Retention policy (PBI 2026-10-18-09): the fallback store holds the only
 * copy of rows whose INSERT failed, so clearAll runs only when every record
 * landed in SQLite. On a partial failure every record is kept for the next
 * launch's retry (INSERT OR IGNORE makes the retry idempotent).
 */

import { errorMessage } from '../../utils/errorUtils.js';
import { ErrorCode } from '../../utils/logger/types.js';
import { logError, logInfo, logWarn } from '../../utils/logger/api.js';
import { FallbackStorage } from '../storageFallback.js';
import { INSERT_IGNORE_SQL, buildInsertParams } from '../schema.js';
import { StorageKeys } from '../../utils/storage/types.js';
import type { SqliteEngine } from '../sqliteEngine.js';
import { extractDomain } from './migrationBackup.js';
import { execWithCache } from './idbEngineLifecycle.js';

export interface FallbackMigrationState {
  idbEngine: SqliteEngine | null;
}

/** Upper bound of per-record error strings kept for the failure log. */
const MAX_LOGGED_FAILURE_REASONS = 3;

/**
 * Attempt to migrate records from FallbackStorage to the IDB-backed SQLite
 * database. Called after successful IDB initialization.
 * On a partial INSERT failure nothing is wiped: the records stay in the
 * fallback store and are retried on the next launch.
 */
export async function tryMigrateFallbackToSqlite(state: FallbackMigrationState): Promise<void> {
  try {
    const tempFallback = new FallbackStorage();
    const records = await tempFallback.getAllRecords();

    if (records.length === 0) {
      // No records to migrate, but OPFS is available so clear the fallback flag
      try { await chrome.storage.local.remove(StorageKeys.OPFS_FALLBACK_MODE); } catch { /* offscreen context */ }
      return;
    }

    if (!state.idbEngine) {
      return;
    }

    let migrated = 0;
    let failed = 0;
    const failureReasons: string[] = [];
    for (const record of records) {
      try {
        const domain = record.domain || extractDomain(record.url);
        await execWithCache(state.idbEngine, INSERT_IGNORE_SQL, buildInsertParams(record, domain));
        migrated++;
      } catch (error) {
        failed++;
        if (failureReasons.length < MAX_LOGGED_FAILURE_REASONS) {
          failureReasons.push(errorMessage(error));
        }
      }
    }

    if (failed === 0) {
      // Every record landed in SQLite (PBI 2026-10-18-09). Only now is the
      // fallback store safe to wipe: it holds the only copy of rows whose
      // INSERT failed, so a partial failure must never trigger clearAll.
      logInfo(`SQLite: migrated ${migrated} records from fallback storage`, { migrated }, 'sqlite');
      await tempFallback.clearAll();
    } else {
      // Partial failure: keep every record so a failed row's only copy is
      // never destroyed. Rows that already landed stay behind as orphans and
      // are re-inserted harmlessly by INSERT OR IGNORE on the next launch,
      // which retries all of them until nothing remains.
      logWarn(
        `SQLite: fallback migration incomplete, keeping ${records.length} records in fallback storage`,
        { migrated, failed, total: records.length, failureReasons },
        ErrorCode.STORAGE_MIGRATION_FAILURE,
        'sqlite'
      );
    }
    // The flag is removed even when records remain: the runtime now writes to
    // the IDB engine, and step 4 of _doInit re-reads the remaining fallback
    // records after every successful IDB init regardless of this flag, so the
    // leftovers are retried without it. Keeping the flag true here would leave
    // opfsRecovery (background) believing the extension is still in fallback
    // mode with a healthy IDB engine.
    try { await chrome.storage.local.remove(StorageKeys.OPFS_FALLBACK_MODE); } catch { /* offscreen context */ }
  } catch (error) {
    logError('SQLite: fallback migration failed', { error: errorMessage(error) }, ErrorCode.STORAGE_MIGRATION_FAILURE, 'sqlite');
  }
}
