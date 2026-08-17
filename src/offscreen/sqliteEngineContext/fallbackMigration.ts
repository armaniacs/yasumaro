/**
 * fallbackMigration.ts
 * Extracted from sqliteEngineContext.ts (PBI-01).
 * Handles migration of records from FallbackStorage (chrome.storage.local)
 * to the IDB-backed SQLite database.
 */

import { errorMessage } from '../../utils/errorUtils.js';
import { logError, logInfo, ErrorCode } from '../../utils/logger.js';
import { FallbackStorage } from '../storageFallback.js';
import { INSERT_IGNORE_SQL, buildInsertParams } from '../schema.js';
import { StorageKeys } from '../../utils/storage/types.js';
import type { SqliteEngine } from '../sqliteEngine.js';
import { extractDomain } from './migrationBackup.js';
import { execWithCache } from './idbEngineLifecycle.js';

export interface FallbackMigrationState {
  idbEngine: SqliteEngine | null;
}

/**
 * Attempt to migrate records from FallbackStorage to the IDB-backed SQLite
 * database. Called after successful IDB initialization.
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
    for (const record of records) {
      try {
        const domain = record.domain || extractDomain(record.url);
        await execWithCache(state.idbEngine, INSERT_IGNORE_SQL, buildInsertParams(record, domain));
        migrated++;
      } catch {
      }
    }

    if (migrated > 0) {
      logInfo(`SQLite: migrated ${migrated} records from fallback storage`, { migrated }, 'sqlite');
      await tempFallback.clearAll();
    }
    try { await chrome.storage.local.remove(StorageKeys.OPFS_FALLBACK_MODE); } catch { /* offscreen context */ }
  } catch (error) {
    logError('SQLite: fallback migration failed', { error: errorMessage(error) }, ErrorCode.STORAGE_MIGRATION_FAILURE, 'sqlite');
  }
}
