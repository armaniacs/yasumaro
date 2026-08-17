/**
 * migrationV2.ts
 * V2 migration: reads old AccessHandlePoolVFS database and imports records
 * into the new OPFSCoopSyncVFS database.
 */

import { migrateOldOpfsDb } from '../opfsMigrationV2.js';
import { readOldDbRecords, deleteOldDbFile } from '../opfsMigrationV2Reader.js';
import { StorageKeys } from '../../utils/storage/types.js';
import { errorMessage } from '../../utils/errorUtils.js';
import type { BrowsingLogRecord } from '../../utils/sqlite-types.js';

export interface MigrationContext {
  handleInsertBatch: (records: BrowsingLogRecord[]) => Promise<{ count: number }>;
  postLog: (level: 'warn' | 'error' | 'info', message: string, details?: Record<string, unknown>) => void;
}

/**
 * Module-level guard to avoid redundant migration attempts within the same
 * Worker lifetime (covers the case where chrome.storage is unavailable).
 */
let migrationV2AttemptedThisSession = false;

export async function runMigrationV2(ctx: MigrationContext): Promise<void> {
  if (migrationV2AttemptedThisSession) return;
  migrationV2AttemptedThisSession = true;

  try {
    const chromeStorageAvailable =
      typeof chrome !== 'undefined' && chrome.storage?.local !== undefined;

    const now = new Date().toISOString();
    if (chromeStorageAvailable) {
      chrome.storage.local.set({ [StorageKeys.OPFS_MIGRATION_V2_LAST_ATTEMPTED_AT]: now });
    }

    const result = await migrateOldOpfsDb({
      isMigrationDone: async () => {
        if (!chromeStorageAvailable) return false;
        return new Promise<boolean>((resolve) => {
          chrome.storage.local.get(StorageKeys.OPFS_MIGRATION_V2_DONE, (items) => {
            resolve(items[StorageKeys.OPFS_MIGRATION_V2_DONE] === true);
          });
        });
      },
      setMigrationDone: async () => {
        if (!chromeStorageAvailable) return;
        await new Promise<void>((resolve) => {
          chrome.storage.local.set({ [StorageKeys.OPFS_MIGRATION_V2_DONE]: true }, resolve);
        });
      },
      readOldRecords: readOldDbRecords,
      insertBatch: ctx.handleInsertBatch,
      deleteOldDb: deleteOldDbFile,
    });

    if (!result.skipped && !result.error && chromeStorageAvailable) {
      const completedAt = new Date().toISOString();
      chrome.storage.local.set({
        [StorageKeys.OPFS_MIGRATION_V2_COMPLETED_AT]: completedAt,
        [StorageKeys.OPFS_MIGRATION_V2_RECORD_COUNT]: result.migrated,
      });
    }

    if (result.skipped) {
      // Already done — nothing to log
    } else if (result.error) {
      ctx.postLog('warn', 'OPFS Worker: V2 migration failed (will retry next init)', { error: result.error });
    } else {
      ctx.postLog('info', `OPFS Worker: V2 migration complete — ${result.migrated} records migrated`, { migrated: result.migrated });
    }
  } catch (err) {
    ctx.postLog('warn', 'OPFS Worker: runMigrationV2 unexpected error', { error: errorMessage(err) });
  }
}
