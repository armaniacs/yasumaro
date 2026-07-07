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
import { errorMessage } from '../utils/errorUtils.js';
import type { BrowsingLogRecord } from '../utils/sqlite-types.js';

/** Separator used when serializing the legacy tags array into the SQLite `tags` TEXT column. */
const TAGS_SEPARATOR = ', ';

/** FallbackStorage のストレージキー */
const FALLBACK_STORAGE_KEY = 'FALLBACK_STORAGE_DATA';

/**
 * Map a legacy chrome.storage.local browsing entry to a SQLite BrowsingLogRecord.
 * `domain` is left null so the SQLite layer derives it from the url.
 * Legacy entries have no title field, so `title` stays null.
 */
export function mapLegacyEntryToRecord(entry: LegacyUrlEntry): BrowsingLogRecord {
  const tags = Array.isArray(entry.tags) && entry.tags.length > 0
    ? entry.tags.join(TAGS_SEPARATOR)
    : null;
  return {
    url: entry.url,
    created_at: entry.timestamp,
    title: null,
    summary: typeof entry.aiSummary === 'string' ? entry.aiSummary : null,
    tags,
    domain: null,
    visit_duration: null,
    scroll_ratio: null,
    is_starred: 0,
    is_deleted: 0,
    content: entry.content ?? null,
    masked_count: entry.maskedCount ?? null,
    cleansed_reason: entry.cleansedReason ?? null,
    ai_provider: entry.aiProvider ?? null,
    ai_model: entry.aiModel ?? null,
    ai_duration_ms: entry.aiDuration ?? null,
    obsidian_duration_ms: entry.obsidianDuration ?? null,
    sent_tokens: entry.sentTokens ?? null,
    received_tokens: entry.receivedTokens ?? null,
    original_tokens: entry.originalTokens ?? null,
    cleansed_tokens: entry.cleansedTokens ?? null,
    page_bytes: entry.pageBytes ?? null,
    candidate_bytes: entry.candidateBytes ?? null,
    original_bytes: entry.originalBytes ?? null,
    cleansed_bytes: entry.cleansedBytes ?? null,
    ai_summary_original_bytes: entry.aiSummaryOriginalBytes ?? null,
    ai_summary_cleansed_bytes: entry.aiSummaryCleansedBytes ?? null,
    fallback_triggered: entry.fallbackTriggered ? 1 : 0,
  };
}

const BATCH_SIZE = 100;
const PROGRESS_WRITE_INTERVAL = 5;
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
        await chrome.storage.local.set({ legacyStoreReadOnly: true });
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
      let batchesSinceLastWrite = 0;
      let lastWrittenProgress = -1;

      for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
        const batch = remaining.slice(i, i + BATCH_SIZE).map(mapLegacyEntryToRecord);

        try {
          const result = await this.sqliteClient.insertBatch(batch);

          if (result !== null) {
            const currentProgress = progress + i + result.count;
            batchesSinceLastWrite++;

            if (batchesSinceLastWrite >= PROGRESS_WRITE_INTERVAL || i + BATCH_SIZE >= remaining.length) {
              await this.setMigrationProgress(currentProgress);
              lastWrittenProgress = currentProgress;
              batchesSinceLastWrite = 0;
            }

            if (result.count < batch.length) {
              hasErrors = true;
              addLog(LogType.WARN, 'Migration: insertBatch partially succeeded', {
                batchSize: batch.length,
                insertedCount: result.count,
              });
            }
          } else {
            hasErrors = true;
            const currentProgress = progress + i;
            if (currentProgress !== lastWrittenProgress) {
              await this.setMigrationProgress(currentProgress);
              lastWrittenProgress = currentProgress;
              batchesSinceLastWrite = 0;
            }
            addLog(LogType.WARN, 'Migration: insertBatch failed or returned null, will retry', {
              batchSize: batch.length,
            });
          }
        } catch (batchError) {
          hasErrors = true;
          const currentProgress = progress + i;
          if (currentProgress !== lastWrittenProgress) {
            await this.setMigrationProgress(currentProgress);
            lastWrittenProgress = currentProgress;
            batchesSinceLastWrite = 0;
          }
          addLog(LogType.ERROR, 'Migration: failed to insert batch', {
            batchSize: batch.length,
            error: errorMessage(batchError),
          });
        }
      }

      if (hasErrors) {
        addLog(LogType.WARN, 'Migration: completed with errors, will retry on next startup', {
          total: entries.length,
        });
        // Don't mark as completed — next startup will retry failed entries
        // (already migrated entries are skipped due to progress tracking)
        return;
      }

      // Mark migration as complete (but do NOT delete original data)
      // Original chrome.storage data is preserved so users can keep using both panels
      // or run an explicit cleanup step from the diagnostics panel.
      await this.setMigrationStatus('completed');
      await chrome.storage.local.remove(MIGRATION_PROGRESS_KEY);

      addLog(LogType.INFO, 'Migration: completed (original data preserved)', {
        totalMigrated: entries.length,
        note: 'Use diagnostics panel to explicitly clean up legacy storage if desired.'
      });
    } catch (error) {
      addLog(LogType.ERROR, 'Migration: failed', {
        error: errorMessage(error),
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

  /**
   * Backfill diagnostic metadata for already-migrated SQLite entries
   * that are missing metric fields. Reads from chrome.storage.local
   * (savedUrlsWithTimestamps) and updates matching SQLite rows.
   */
  async backfillDiagnosticMetadata(): Promise<{ updated: number; total: number }> {
    try {
      const result = await chrome.storage.local.get('savedUrlsWithTimestamps');
      const storageEntries = (result.savedUrlsWithTimestamps as LegacyUrlEntry[]) || [];

      if (storageEntries.length === 0) {
        return { updated: 0, total: 0 };
      }

      addLog(LogType.INFO, 'Backfill: starting', { storageEntries: storageEntries.length });

      // Build lookup map: url+timestamp (rounded to minute) → entry
      const storageMap = new Map<string, LegacyUrlEntry>();
      for (const entry of storageEntries) {
        const key = `${entry.url}|${Math.floor(entry.timestamp / 60000)}`;
        const hasData = entry.sentTokens != null || entry.receivedTokens != null ||
          entry.pageBytes != null || entry.aiProvider != null;
        if (hasData) {
          storageMap.set(key, entry);
        }
      }

      if (storageMap.size === 0) {
        addLog(LogType.INFO, 'Backfill: no storage entries with diagnostic data');
        return { updated: 0, total: 0 };
      }

      // Query all non-deleted SQLite entries
      const allResult = await this.sqliteClient.query({ limit: 50000 });
      if (!allResult || allResult.rows.length === 0) {
        return { updated: 0, total: 0 };
      }

      let updated = 0;

      for (const sqliteRow of allResult.rows) {
        const record = sqliteRow as BrowsingLogRecord;
        if (record.id == null) continue;

        // Skip entries that already have diagnostic data
        if (record.sent_tokens != null || record.received_tokens != null) continue;

        // Look up in storage map
        const key = `${record.url}|${Math.floor(record.created_at / 60000)}`;
        const entry = storageMap.get(key);
        if (!entry) continue;

        // Build update payload
        const changes: Record<string, unknown> = {};
        if (entry.sentTokens != null) changes.sent_tokens = entry.sentTokens;
        if (entry.receivedTokens != null) changes.received_tokens = entry.receivedTokens;
        if (entry.originalTokens != null) changes.original_tokens = entry.originalTokens;
        if (entry.cleansedTokens != null) changes.cleansed_tokens = entry.cleansedTokens;
        if (entry.pageBytes != null) changes.page_bytes = entry.pageBytes;
        if (entry.candidateBytes != null) changes.candidate_bytes = entry.candidateBytes;
        if (entry.originalBytes != null) changes.original_bytes = entry.originalBytes;
        if (entry.cleansedBytes != null) changes.cleansed_bytes = entry.cleansedBytes;
        if (entry.aiSummaryOriginalBytes != null) changes.ai_summary_original_bytes = entry.aiSummaryOriginalBytes;
        if (entry.aiSummaryCleansedBytes != null) changes.ai_summary_cleansed_bytes = entry.aiSummaryCleansedBytes;
        if (entry.aiProvider != null) changes.ai_provider = entry.aiProvider;
        if (entry.aiModel != null) changes.ai_model = entry.aiModel;
        if (entry.aiDuration != null) changes.ai_duration_ms = entry.aiDuration;
        if (entry.obsidianDuration != null) changes.obsidian_duration_ms = entry.obsidianDuration;
        if (entry.content != null) changes.content = entry.content;
        if (entry.maskedCount != null) changes.masked_count = entry.maskedCount;
        if (entry.cleansedReason != null) changes.cleansed_reason = entry.cleansedReason;
        if (entry.fallbackTriggered != null) changes.fallback_triggered = entry.fallbackTriggered ? 1 : 0;

        if (Object.keys(changes).length === 0) continue;

        const ok = await this.sqliteClient.update(record.id, changes);
        if (ok) updated++;
      }

      addLog(LogType.INFO, 'Backfill: completed', { updated, total: allResult.rows.length });
      return { updated, total: allResult.rows.length };
    } catch (error) {
      addLog(LogType.ERROR, 'Backfill: failed', { error: errorMessage(error) });
      return { updated: 0, total: 0 };
    }
  }

  /**
   * Explicitly clean up legacy chrome.storage keys.
   * This is a destructive operation that should only be called
   * after the user has confirmed they want to remove the original data.
   * The data is already in SQLite at this point.
   */
  async cleanupLegacyStorage(): Promise<{ removed: string[]; totalBytes: number }> {
    try {
      const legacyKeys = ['savedUrlsWithTimestamps', 'savedUrls'];
      const data = await chrome.storage.local.get(legacyKeys);
      const totalBytes = Object.values(data).reduce(
        (sum: number, val) => sum + (val ? JSON.stringify(val).length : 0),
        0
      );
      await chrome.storage.local.remove(legacyKeys);
      await chrome.storage.local.remove('legacyStoreReadOnly');
      addLog(LogType.INFO, 'Cleanup: legacy storage keys removed', { keys: legacyKeys, totalBytes });
      return { removed: legacyKeys, totalBytes };
    } catch (error) {
      addLog(LogType.ERROR, 'Cleanup: failed', { error: errorMessage(error) });
      return { removed: [], totalBytes: 0 };
    }
  }

  /**
   * OPFS 復旧時のマイグレーションが必要かチェック
   * - OPFS_FALLBACK_MODE が true
   * - SQLite が OPFS/IDB で利用可能
   * - フォールバックデータが存在する
   */
  async needsOpfsRecoveryMigration(): Promise<boolean> {
    try {
      // 1. フォールバックモードかチェック
      const fallbackResult = await chrome.storage.local.get(StorageKeys.OPFS_FALLBACK_MODE);
      const isFallbackMode = fallbackResult[StorageKeys.OPFS_FALLBACK_MODE] === true;

      if (!isFallbackMode) {
        return false;
      }

      // 2. SQLite が利用可能かチェック
      const statusResult = await this.sqliteClient.getStatus();
      if (!statusResult || statusResult.fallback === true) {
        // まだフォールバックモードのまま
        return false;
      }

      // 3. フォールバックデータが存在するかチェック
      const dataResult = await chrome.storage.local.get(FALLBACK_STORAGE_KEY);
      const fallbackData = dataResult[FALLBACK_STORAGE_KEY] as { records: BrowsingLogRecord[] } | undefined;

      if (!fallbackData || !fallbackData.records || !Array.isArray(fallbackData.records) || fallbackData.records.length === 0) {
        return false;
      }

      return true;
    } catch (error) {
      addLog(LogType.ERROR, 'OPFS recovery check failed', { error: errorMessage(error) });
      return false; // エラー時は安全側に倒す
    }
  }

  /**
   * OPFS 復旧時にフォールバックデータを SQLite に移行
   */
  async migrateOpfsRecovery(): Promise<{ success: boolean; migrated: number; error?: string }> {
    let totalMigrated = 0;

    try {
      // フォールバックデータを取得
      const dataResult = await chrome.storage.local.get(FALLBACK_STORAGE_KEY);
      const fallbackData = dataResult[FALLBACK_STORAGE_KEY] as { records: BrowsingLogRecord[] } | undefined;

      if (!fallbackData || !fallbackData.records || !Array.isArray(fallbackData.records)) {
        return { success: true, migrated: 0 };
      }

      const records = fallbackData.records;
      addLog(LogType.INFO, 'OPFS recovery: starting migration', { totalRecords: records.length });

      // バッチ単位で SQLite にインポート
      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE).map(convertFallbackRecord);

        try {
          const result = await this.sqliteClient.insertBatch(batch);

          if (result !== null) {
            totalMigrated += result.count;
          } else {
            return {
              success: false,
              migrated: totalMigrated,
              error: 'insertBatch returned null',
            };
          }
        } catch (batchError) {
          return {
            success: false,
            migrated: totalMigrated,
            error: errorMessage(batchError),
          };
        }
      }

      // 移行完了 — まずデータを削除し、最後にフラグをクリアする
      // (データ削除を先に行うことで、途中でSW終了しても復旧可能に保つ)
      await chrome.storage.local.remove(FALLBACK_STORAGE_KEY);
      await chrome.storage.local.remove(StorageKeys.OPFS_FALLBACK_MODE);

      addLog(LogType.INFO, 'OPFS recovery: migration completed', { migrated: totalMigrated });

      return { success: true, migrated: totalMigrated };
    } catch (error) {
      addLog(LogType.ERROR, 'OPFS recovery: migration failed', { error: errorMessage(error) });
      return {
        success: false,
        migrated: totalMigrated,
        error: errorMessage(error),
      };
    }
  }
}

/**
 * フォールバックデータを BrowsingLogRecord 形式に変換
 */
function convertFallbackRecord(record: BrowsingLogRecord): BrowsingLogRecord {
  return {
    url: record.url,
    title: record.title ?? null,
    summary: record.summary ?? null,
    tags: record.tags ?? null,
    created_at: record.created_at,
    domain: record.domain ?? null,
    visit_duration: record.visit_duration ?? null,
    scroll_ratio: record.scroll_ratio ?? null,
    is_starred: record.is_starred ?? 0,
    is_deleted: record.is_deleted ?? 0,
    obsidian_synced: record.obsidian_synced ?? 0,
  };
}

/**
 * Legacy URL entry format from chrome.storage.local.
 */
interface LegacyUrlEntry {
  url: string;
  timestamp: number;
  tags?: string[];
  aiSummary?: string;
  content?: string;
  cleansedReason?: string;
  maskedCount?: number;
  sentTokens?: number;
  receivedTokens?: number;
  originalTokens?: number;
  cleansedTokens?: number;
  pageBytes?: number;
  candidateBytes?: number;
  originalBytes?: number;
  cleansedBytes?: number;
  aiSummaryOriginalBytes?: number;
  aiSummaryCleansedBytes?: number;
  aiSummaryCleansedElements?: number;
  aiSummaryCleansedReason?: string;
  aiProvider?: string;
  aiModel?: string;
  aiDuration?: number;
  obsidianDuration?: number;
  fallbackTriggered?: boolean;
  [key: string]: unknown;
}
