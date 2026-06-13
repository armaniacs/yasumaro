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
import { StorageKeys } from '../utils/storage.js';

export class ObsidianSyncService {
  private obsidianClient: ObsidianClient;
  private sqliteClient: SqliteClient;

  static readonly BATCH_SIZE = 5;
  static readonly BATCH_INTERVAL_MS = 30_000;

  constructor(obsidianClient: ObsidianClient, sqliteClient: SqliteClient) {
    this.obsidianClient = obsidianClient;
    this.sqliteClient = sqliteClient;
  }

  /**
   * Check if Obsidian is configured (has API key in storage).
   */
  async isConfigured(): Promise<boolean> {
    try {
      const result = await chrome.storage.local.get(StorageKeys.OBSIDIAN_API_KEY);
      const key = result[StorageKeys.OBSIDIAN_API_KEY];
      return typeof key === 'string' && key.length >= 16;
    } catch {
      return false;
    }
  }

  /**
   * Try to sync a log to Obsidian. Silently skips if Obsidian is not configured.
   * Returns true if synced, false if skipped or failed.
   */
  async sync(logId: number, url: string, title: string | null, summary: string | null): Promise<boolean> {
    if (!(await this.isConfigured())) {
      return false;
    }

    try {
      // Use the existing ObsidianClient to append to daily note
      const markdown = `- [${title || url}](${url})${summary ? `: ${summary}` : ''}`;
      await this.obsidianClient.appendToDailyNote(markdown);
      // Mark as synced in SQLite
      await this.sqliteClient.update(logId, { obsidian_synced: 1 });
      addLog(LogType.INFO, 'ObsidianSync: synced', { url, logId });
      return true;
    } catch (error) {
      addLog(LogType.WARN, 'ObsidianSync: failed (silent skip)', {
        error: errorMessage(error),
        url,
      });
      return false;
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

    try {
      const result = await this.sqliteClient.query({
        limit: ObsidianSyncService.BATCH_SIZE,
        orderBy: 'created_at',
        orderDir: 'DESC',
      });

      if (!result || !result.rows || result.rows.length === 0) {
        return 0;
      }

      const unsyncedRows = result.rows.filter((r) => !r.obsidian_synced);
      if (unsyncedRows.length === 0) {
        return 0;
      }

      let syncedCount = 0;
      for (const row of unsyncedRows) {
        if (row.id === undefined) continue;
        const synced = await this.sync(row.id, row.url, row.title ?? null, row.summary ?? null);
        if (synced) {
          syncedCount++;
        }
      }

      if (syncedCount > 0) {
        addLog(LogType.INFO, 'ObsidianSync: batch completed', { synced: syncedCount });
      }

      return syncedCount;
    } catch (error) {
      addLog(LogType.WARN, 'ObsidianSync: batch failed', {
        error: errorMessage(error),
      });
      return 0;
    }
  }

  /**
   * Test Obsidian connection by calling the health endpoint.
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!(await this.isConfigured())) {
      return { success: false, message: 'Obsidian not configured (no API key)' };
    }

    try {
      const result = await this.obsidianClient.testConnection();
      return { success: true, message: 'Connected successfully' };
    } catch (error) {
      return {
        success: false,
        message: `Connection failed: ${errorMessage(error)}`,
      };
    }
  }
}
