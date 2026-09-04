/**
 * deferredMigrations.ts
 * Extracted from service-worker.ts (PBI-05).
 * Runs SessionStore + SQLite data migrations once before the first message
 * handler invocation, instead of at SW startup (which raced with E2E tests).
 */

import { logInfo, logError, ErrorCode } from '../utils/logger.js';
import { migrateToSingleSettingsObject } from '../utils/storage/settingsMigration.js';
import { migrateLegacyPendingPagesKey } from '../utils/pendingStorage.js';
import { SessionStore } from './sessionStore.js';
import { MigrationService } from './migrationService.js';
import type { SqliteClient } from './sqlite/offscreenGateway.js';

async function runMigration(): Promise<void> {
  try {
    const migrated = await migrateToSingleSettingsObject();
    if (migrated) {
      logInfo('Settings migrated to single object', { migrated: true }, 'service-worker');
    }
  } catch (e) {
    logError(
      'Failed to migrate settings',
      { error: e instanceof Error ? e.message : String(e) },
      ErrorCode.STORAGE_MIGRATION_FAILURE,
      'service-worker'
    );
  }

  await migrateLegacyPendingPagesKey();
}

export function createDeferredMigrationRunner(sqliteClient: SqliteClient): () => Promise<void> {
  let ran = false;

  return async () => {
    if (ran) return;
    ran = true;
    try {
      await runMigration();
      SessionStore.migrateFromLocalStorage().catch((err) => {
        logError('SessionStore migration failed', { error: String(err) }, ErrorCode.STORAGE_MIGRATION_FAILURE, 'service-worker');
      });
      const migrationService = new MigrationService(sqliteClient);
      await migrationService.run();
      const needsRecovery = await migrationService.needsOpfsRecoveryMigration();
      if (needsRecovery) {
        logInfo('OPFS recovery migration triggered', {}, 'service-worker');
        const result = await migrationService.migrateOpfsRecovery();
        if (result.success) {
          logInfo('OPFS recovery completed', { migrated: result.migrated }, 'service-worker');
        } else {
          logError('OPFS recovery failed', { error: result.error || 'Unknown error' }, ErrorCode.STORAGE_MIGRATION_FAILURE, 'service-worker');
        }
      }
    } catch (err) {
      logError('Deferred startup migration failed', { error: String(err) }, ErrorCode.STORAGE_MIGRATION_FAILURE, 'service-worker');
    }
  };
}
