/**
 * obsidianSyncService.ts
 * Bridges SQLite browsing logs with Obsidian REST API.
 * After a log is saved to SQLite, attempts to sync to Obsidian silently.
 * If Obsidian is not running or not configured, skips gracefully.
 */

import { ObsidianClient } from './obsidianClient.js';
import { SqliteClient } from './sqliteClient.js';
import { addLog, LogType } from '../utils/logger.js';
import { StorageKeys } from '../utils/storage.js';

export class ObsidianSyncService {
  private obsidianClient: ObsidianClient;
  private sqliteClient: SqliteClient;

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
      return !!key;
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
        error: error instanceof Error ? error.message : String(error),
        url,
      });
      return false;
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
        message: `Connection failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
