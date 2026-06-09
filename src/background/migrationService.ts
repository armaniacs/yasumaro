/**
 * migrationService.ts
 * Migrates existing chrome.storage.local browsing data to SQLite (OPFS).
 * Designed for Phase 2 of the yasumaro SQLite migration plan.
 *
 * Pattern: src/utils/migration.ts (settings migration)
 */

import { addLog, LogType } from '../utils/logger.js';
import { StorageKeys } from '../utils/storage.js';
import { SqliteClient } from './sqliteClient.js';

const BATCH_SIZE = 100;
const MIGRATION_STATUS_KEY = StorageKeys.YASUMARO_MIGRATION_STATUS;
const MIGRATION_PROGRESS_KEY = StorageKeys.YASUMARO_MIGRATION_PROGRESS;

type MigrationStatus = 'pending' | 'completed' | 'fresh_install';

/**
 * MigrationService handles one-time migration of legacy browsing log data
 * from chrome.storage.local into the SQLite database.
 */
export class MigrationService {
  private sqliteClient: SqliteClient;

  constructor(sqliteClient: SqliteClient) {
    this.sqliteClient = sqliteClient;
  }

  /**
   * Run the migration if needed. Safe to call multiple times.
   */
  async run(): Promise<void> {
    try {
      const status = await this.getMigrationStatus();

      if (status === 'completed' || status === 'fresh_install') {
        addLog(LogType.INFO, 'Migration: already completed or fresh install', { status });
        return;
      }

      addLog(LogType.INFO, 'Migration: starting data migration', { status });

      // Read all legacy browsing data
      const result = await chrome.storage.local.get('savedUrlsWithTimestamps');
      const entries = (result.savedUrlsWithTimestamps as LegacyUrlEntry[]) || [];

      if (entries.length === 0) {
        // No data to migrate — mark as fresh install
        await this.setMigrationStatus('fresh_install');
        addLog(LogType.INFO, 'Migration: no legacy data found, marked as fresh install');
        return;
      }

      // Resume from previous progress if interrupted
      const progress = await this.getMigrationProgress();
      const remaining = entries.slice(progress);

      addLog(LogType.INFO, 'Migration: migrating data', {
        total: entries.length,
        alreadyMigrated: progress,
        remaining: remaining.length,
      });

      // Process in batches
      let hasErrors = false;

      for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
        const batch = remaining.slice(i, i + BATCH_SIZE);
        let batchSuccessCount = 0;

        for (const entry of batch) {
          try {
            const result = await this.sqliteClient.insert({
              url: entry.url,
              created_at: entry.timestamp,
              title: null,
              summary: null,
              tags: null,
              domain: null,
              visit_duration: null,
              scroll_ratio: null,
              is_starred: 0,
              is_deleted: 0,
            });

            if (result !== null) {
              batchSuccessCount++;
            } else {
              hasErrors = true;
              addLog(LogType.WARN, 'Migration: insert returned null, will retry', {
                url: entry.url,
              });
            }
          } catch (insertError) {
            hasErrors = true;
            addLog(LogType.ERROR, 'Migration: failed to insert record', {
              url: entry.url,
              error: insertError instanceof Error ? insertError.message : String(insertError),
            });
            // Continue with next entry — don't fail the whole batch
          }
        }

        // Save progress after each batch (so interrupted runs can resume)
        const completedCount = progress + i + batch.length;
        await this.setMigrationProgress(completedCount);
      }

      if (hasErrors) {
        addLog(LogType.WARN, 'Migration: completed with errors, will retry on next startup', {
          total: entries.length,
        });
        // Don't mark as completed — next startup will retry failed entries
        // (already migrated entries are skipped due to progress tracking)
        return;
      }

      // Mark migration as complete
      await this.setMigrationStatus('completed');
      await chrome.storage.local.remove(MIGRATION_PROGRESS_KEY);

      addLog(LogType.INFO, 'Migration: completed', { totalMigrated: entries.length });
    } catch (error) {
      addLog(LogType.ERROR, 'Migration: failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't set status — next startup will retry
    }
  }

  /** Read the current migration status from chrome.storage.local */
  private async getMigrationStatus(): Promise<MigrationStatus | null> {
    const result = await chrome.storage.local.get(MIGRATION_STATUS_KEY);
    return (result[MIGRATION_STATUS_KEY] as MigrationStatus) || null;
  }

  /** Persist migration status */
  private async setMigrationStatus(status: MigrationStatus): Promise<void> {
    await chrome.storage.local.set({ [MIGRATION_STATUS_KEY]: status });
  }

  /** Read migration progress (number of entries already migrated) */
  private async getMigrationProgress(): Promise<number> {
    const result = await chrome.storage.local.get(MIGRATION_PROGRESS_KEY);
    return (result[MIGRATION_PROGRESS_KEY] as number) || 0;
  }

  /** Save migration progress */
  private async setMigrationProgress(count: number): Promise<void> {
    await chrome.storage.local.set({ [MIGRATION_PROGRESS_KEY]: count });
  }
}

/**
 * Legacy URL entry format from chrome.storage.local.
 */
interface LegacyUrlEntry {
  url: string;
  timestamp: number;
  [key: string]: unknown;
}
