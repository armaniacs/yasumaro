/**
 * legacyMigration.ts
 * Legacy chrome.storage.local → SQLite migration with retry/give-up state machine.
 * Extracted from migrationService.ts (PBI 2026-08-22-01).
 *
 * Jobs: run(), backfillDiagnosticMetadata(), cleanupLegacyStorage()
 */

import { addLog, LogType } from '../../utils/logger.js';
import { SqliteClient } from '../sqlite/offscreenGateway.js';
import { errorMessage } from '../../utils/errorUtils.js';
import type { BrowsingLogRecord } from '../../utils/sqlite-types.js';
import type { MigrationStatePort } from './migrationState.js';
import { MIGRATION_PROGRESS_KEY, MIGRATION_RETRY_COUNT_KEY } from './migrationState.js';

/** Separator used when serializing the legacy tags array into the SQLite `tags` TEXT column. */
const TAGS_SEPARATOR = ', ';

/** Legacy URL entry format from chrome.storage.local. */
export interface LegacyUrlEntry {
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

const BATCH_SIZE = 100;
const PROGRESS_WRITE_INTERVAL = 5;

/** Maximum consecutive failures before giving up on migration. */
const MAX_MIGRATION_RETRY_COUNT = 5;

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

/**
 * LegacyMigrationService handles migration of legacy chrome.storage.local
 * browsing data to SQLite, plus backfill and cleanup operations.
 */
export class LegacyMigrationService {
  constructor(
    private readonly sqliteClient: SqliteClient,
    private readonly state: MigrationStatePort,
  ) {}

  /**
   * Run the legacy data migration if needed. Safe to call multiple times.
   */
  async run(): Promise<void> {
    try {
      const status = await this.state.getStatus();

      if (status === 'completed' || status === 'fresh_install') {
        addLog(LogType.INFO, 'Migration: already completed or fresh install', { status });
        return;
      }

      if (status === 'failed_permanently') {
        addLog(LogType.WARN, 'Migration: skipped — retry limit previously reached', { status });
        return;
      }

      addLog(LogType.INFO, 'Migration: starting data migration', { status });

      // Read all legacy browsing data
      const result = await chrome.storage.local.get('savedUrlsWithTimestamps');
      const entries = (result.savedUrlsWithTimestamps as LegacyUrlEntry[]) || [];

      if (entries.length === 0) {
        // No data to migrate — mark as fresh install
        await this.state.setStatus('fresh_install');
        await chrome.storage.local.set({ legacyStoreReadOnly: true });
        addLog(LogType.INFO, 'Migration: no legacy data found, marked as fresh install');
        return;
      }

      // Resume from previous progress if interrupted
      const progress = await this.state.getProgress();
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
          const result = await this.sqliteClient.mutate({ type: 'insertBatch', records: batch });

          const normalized = result;
          if (normalized.success) {
            const currentProgress = progress + i + normalized.data.count;
            batchesSinceLastWrite++;

            if (batchesSinceLastWrite >= PROGRESS_WRITE_INTERVAL || i + BATCH_SIZE >= remaining.length) {
              await this.state.setProgress(currentProgress);
              lastWrittenProgress = currentProgress;
              batchesSinceLastWrite = 0;
            }

            if (normalized.data.count < batch.length) {
              hasErrors = true;
              addLog(LogType.WARN, 'Migration: insertBatch partially succeeded', {
                batchSize: batch.length,
                insertedCount: normalized.data.count,
              });
            }
          } else {
            hasErrors = true;
            const currentProgress = progress + i;
            if (currentProgress !== lastWrittenProgress) {
              await this.state.setProgress(currentProgress);
              lastWrittenProgress = currentProgress;
              batchesSinceLastWrite = 0;
            }
            addLog(LogType.WARN, 'Migration: insertBatch failed, will retry', {
              batchSize: batch.length,
              error: normalized.error.message,
            });
          }
        } catch (batchError) {
          hasErrors = true;
          const currentProgress = progress + i;
          if (currentProgress !== lastWrittenProgress) {
            await this.state.setProgress(currentProgress);
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
        await this.recordFailureAndMaybeGiveUp(entries.length);
        return;
      }

      // Mark migration as complete (but do NOT delete original data)
      await this.state.setStatus('completed');
      await chrome.storage.local.remove(MIGRATION_PROGRESS_KEY);
      await chrome.storage.local.remove(MIGRATION_RETRY_COUNT_KEY);

      addLog(LogType.INFO, 'Migration: completed (original data preserved)', {
        totalMigrated: entries.length,
        note: 'Use diagnostics panel to explicitly clean up legacy storage if desired.',
      });
    } catch (error) {
      addLog(LogType.ERROR, 'Migration: failed', {
        error: errorMessage(error),
      });
      try {
        await this.recordFailureAndMaybeGiveUp();
      } catch (retryTrackingError) {
        // Storage itself may be unavailable (the same failure that triggered the
        // outer catch). Retry tracking is best-effort — next startup will simply
        // retry from scratch (retryCount defaults to 0 when unreadable).
        addLog(LogType.WARN, 'Migration: failed to record retry count', {
          error: errorMessage(retryTrackingError),
        });
      }
    }
  }

  /**
   * Increment the retry counter after a failed migration attempt.
   * Once MAX_MIGRATION_RETRY_COUNT consecutive failures are reached, the status
   * is set to 'failed_permanently' so subsequent startups stop retrying and the
   * failure can be surfaced to the user via the diagnostics panel.
   */
  private async recordFailureAndMaybeGiveUp(totalEntries?: number): Promise<void> {
    const retryCount = (await this.state.getRetryCount()) + 1;
    await this.state.setRetryCount(retryCount);

    if (retryCount >= MAX_MIGRATION_RETRY_COUNT) {
      await this.state.setStatus('failed_permanently');
      addLog(LogType.ERROR, 'Migration: retry limit reached, giving up', {
        retryCount,
        maxRetryCount: MAX_MIGRATION_RETRY_COUNT,
        total: totalEntries,
      });
      return;
    }

    addLog(LogType.WARN, 'Migration: completed with errors, will retry on next startup', {
      retryCount,
      maxRetryCount: MAX_MIGRATION_RETRY_COUNT,
      total: totalEntries,
    });
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
      if (!allResult.success) {
        throw new Error(`Backfill query failed: ${allResult.error.message}`);
      }
      if (allResult.data.rows.length === 0) {
        return { updated: 0, total: 0 };
      }

      let updated = 0;

      for (const sqliteRow of allResult.data.rows) {
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

        const ok = await this.sqliteClient.mutate({ type: 'update', id: record.id, changes });
        if (ok.success) updated++;
      }

      addLog(LogType.INFO, 'Backfill: completed', { updated, total: allResult.data.rows.length });
      return { updated, total: allResult.data.rows.length };
    } catch (error) {
      addLog(LogType.ERROR, 'Backfill: failed', { error: errorMessage(error) });
      throw error;
    }
  }

  /**
   * Explicitly clean up legacy chrome.storage keys.
   * This is a destructive operation that should only be called
   * after the user has confirmed they want to remove the original data.
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
}
