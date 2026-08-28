/**
 * obsidianSyncService.ts
 * Bridges SQLite browsing logs with Obsidian REST API.
 * After a log is saved to SQLite, attempts to sync to Obsidian silently.
 * If Obsidian is not running or not configured, skips gracefully.
 */

import { ObsidianClient } from './obsidianClient.js';
import { SqliteClient } from './sqliteClient.js';
import { addLog, LogType } from '../utils/logger.js';
import { errorMessage } from '../utils/errorUtils.js';
import { StorageKeys } from '../utils/storage/types.js';
import { settingsRepository, type SettingsReader } from '../utils/storage/SettingsRepository.js';
import { sanitizeForObsidian, sanitizeUrlForMarkdownTarget } from '../utils/markdownSanitizer.js';
import type { SyncTarget } from './syncTargets/SyncTarget.js';
import { isCredentialConfigured } from './syncTargets/settingsConfiguredCheck.js';
import { SyncBatchRunner, type PendingSyncRow } from './syncTargets/SyncBatchRunner.js';

export class ObsidianSyncService implements SyncTarget {
  private obsidianClient: ObsidianClient;
  private sqliteClient: SqliteClient;
  private settingsReader: SettingsReader;
  private batchRunner: SyncBatchRunner;

  static readonly BATCH_SIZE = 5;
  static readonly BATCH_INTERVAL_MS = 30_000;

  constructor(obsidianClient: ObsidianClient, sqliteClient: SqliteClient, settingsReader: SettingsReader = settingsRepository) {
    this.obsidianClient = obsidianClient;
    this.sqliteClient = sqliteClient;
    this.settingsReader = settingsReader;
    this.batchRunner = new SyncBatchRunner({
      targetName: 'ObsidianSync',
      // WHY: no gistSynced-style query filter exists for obsidian_synced, so pending
      // rows are still fetched via a plain page and filtered client-side (kept from
      // the pre-extraction behavior); BATCH_SIZE policy now lives in the runner.
      listPending: (limit) => this.listPending(limit),
      markSynced: (row) => this.syncRow(row),
      batchSize: ObsidianSyncService.BATCH_SIZE,
      maxIterations: 1,
    });
  }

  /**
   * Check if Obsidian is configured (has API key in storage).
   */
  async isConfigured(): Promise<boolean> {
    return isCredentialConfigured(this.settingsReader, StorageKeys.OBSIDIAN_API_KEY, 16);
  }

  /**
   * Try to sync a log to Obsidian. Silently skips if Obsidian is not configured.
   * Returns true if synced, false if skipped or failed.
   */
  async sync(logId: number, url: string, title: string | null, summary: string | null): Promise<{ success: boolean; error?: string }> {
    if (!(await this.isConfigured())) {
      return { success: false };
    }

    try {
      // Use the existing ObsidianClient to append to daily note
      const sanitizedTitle = sanitizeForObsidian(title || url || 'Untitled');
      const sanitizedUrl = sanitizeUrlForMarkdownTarget(url);
      const sanitizedSummary = summary ? sanitizeForObsidian(summary) : null;
      const markdown = `- [${sanitizedTitle}](${sanitizedUrl})${sanitizedSummary ? `: ${sanitizedSummary}` : ''}`;
      await this.obsidianClient.appendToDailyNote(markdown);
      // Mark as synced in SQLite
      await this.sqliteClient.mutate({ type: 'update', id: logId, changes: { obsidian_synced: 1 } });
      addLog(LogType.INFO, 'ObsidianSync: synced', { url, logId });
      return { success: true };
    } catch (error) {
      addLog(LogType.WARN, 'ObsidianSync: failed (silent skip)', {
        error: errorMessage(error),
        url,
      });
      return { success: false };
    }
  }

  /**
   * Process a batch of unsynced records from SQLite and sync them to Obsidian.
   * Uses BATCH_SIZE to limit API calls per invocation.
   * Returns the number of records successfully synced.
   */
  async syncBatch(): Promise<number> {
    if (!(await this.isConfigured())) {
      return 0;
    }

    return this.batchRunner.run();
  }

  /** SyncBatchRunner ListPending port: fetches up to `limit` rows and filters unsynced ones client-side. */
  private async listPending(limit: number): Promise<PendingSyncRow[]> {
    const result = await this.sqliteClient.query({
      limit,
      orderBy: 'created_at',
      orderDir: 'DESC',
    });

    if (!result.success) {
      throw new Error(`Obsidian sync query failed: ${result.error.message}`);
    }

    return result.data.rows
      .filter((row) => !row.obsidian_synced && row.id !== undefined)
      .map((row) => ({ id: row.id as number, url: row.url, title: row.title ?? null, summary: row.summary ?? null }));
  }

  /** SyncBatchRunner MarkSynced port: syncs one row (sync() itself marks it via sqliteClient.mutate). */
  private async syncRow(row: PendingSyncRow): Promise<boolean> {
    const result = await this.sync(row.id, row.url, row.title, row.summary);
    return result.success;
  }

  /**
   * Test Obsidian connection by calling the health endpoint.
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!(await this.isConfigured())) {
      return { success: false, message: 'Obsidian not configured (no API key)' };
    }

    try {
      const _result = await this.obsidianClient.testConnection();
      return { success: true, message: 'Connected successfully' };
    } catch (error) {
      return {
        success: false,
        message: `Connection failed: ${errorMessage(error)}`,
      };
    }
  }
}
