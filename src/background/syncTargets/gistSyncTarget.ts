/**
 * gistSyncTarget.ts
 * GitHub Gist sync target implementation.
 * Syncs browsing history entries to a GitHub Gist as Markdown.
 */

import type { SyncTarget } from './SyncTarget.js';
import { SqliteClient } from '../sqliteClient.js';
import { addLog, LogType } from '../../utils/logger.js';
import { errorMessage } from '../../utils/errorUtils.js';
import { SettingsRepository, settingsRepository, type SettingsReader } from '../../utils/storage/SettingsRepository.js';
import { StorageKeys } from '../../utils/storage/types.js';
import { sanitizeForObsidian, sanitizeForMarkdownLinkText, sanitizeUrlForMarkdownTarget } from '../../utils/markdownSanitizer.js';
import { CONNECTION_TEST_CACHE_MODE, fetchWithTimeout } from '../../utils/fetch.js';
import { readJsonCapped } from '../../utils/readBodyCapped.js';
import { isCredentialConfigured } from './settingsConfiguredCheck.js';
import { SyncBatchRunner, type PendingSyncRow } from './SyncBatchRunner.js';

const GIST_API_BASE = 'https://api.github.com';

export class GistSyncTarget implements SyncTarget {
  private sqliteClient: SqliteClient;
  private settingsReader: SettingsReader;
  private batchRunner: SyncBatchRunner;

  constructor(sqliteClient: SqliteClient, settingsReader: SettingsReader = settingsRepository) {
    this.sqliteClient = sqliteClient;
    this.settingsReader = settingsReader;
    this.batchRunner = new SyncBatchRunner({
      targetName: 'GistSync',
      listPending: (limit) => this.listPending(limit),
      markSynced: (row) => this.syncRow(row),
    });
  }

  async isConfigured(): Promise<boolean> {
    return isCredentialConfigured(this.settingsReader, StorageKeys.GITHUB_PAT, 1);
  }

  async sync(logId: number, url: string, title: string | null, summary: string | null, markdown?: string): Promise<{ success: boolean; error?: string }> {
    if (!(await this.isConfigured())) {
      return { success: false };
    }

    try {
      const settings = await new SettingsRepository().getAll();
      const pat = settings[StorageKeys.GITHUB_PAT] as string;
      const gistId = settings[StorageKeys.GIST_ID] as string | undefined;
      const defaultEntry = () => {
        const safeTitle = sanitizeForMarkdownLinkText(title || url || 'Untitled');
        const safeUrl = sanitizeUrlForMarkdownTarget(url);
        const safeSummary = summary ? sanitizeForObsidian(summary) : null;
        return `- [${safeTitle}](${safeUrl})${safeSummary ? `: ${safeSummary}` : ''}`;
      };
      const entry = markdown || defaultEntry();

      if (gistId) {
        // Update existing Gist
        await this.updateGist(gistId, entry, pat);
      } else {
        // Create new Gist
        const newGistId = await this.createGist(entry, pat);
        await new SettingsRepository().set(StorageKeys.GIST_ID, newGistId);
      }

      await this.sqliteClient.mutate({ type: 'update', id: logId, changes: { gist_synced: 1 } });
      addLog(LogType.INFO, 'GistSync: synced', { url, logId });
      return { success: true };
    } catch (error) {
      const errMsg = errorMessage(error);
      addLog(LogType.WARN, 'GistSync: failed (silent skip)', {
        error: errMsg,
        url,
      });
      return { success: false, error: errMsg };
    }
  }

  async syncBatch(): Promise<number> {
    if (!(await this.isConfigured())) {
      return 0;
    }

    return this.batchRunner.run();
  }

  /** SyncBatchRunner ListPending port: fetches up to `limit` unsynced rows. */
  private async listPending(limit: number): Promise<PendingSyncRow[]> {
    const result = await this.sqliteClient.query({
      limit,
      offset: 0,
      orderBy: 'created_at',
      orderDir: 'DESC',
      gistSynced: 0,
    });

    if (!result.success) {
      throw new Error(`Gist sync query failed: ${result.error.message}`);
    }

    return result.data.rows
      .filter((row) => row.id !== undefined)
      .map((row) => ({ id: row.id as number, url: row.url, title: row.title ?? null, summary: row.summary ?? null }));
  }

  /** SyncBatchRunner MarkSynced port: syncs one row (sync() itself marks it via sqliteClient.mutate). */
  private async syncRow(row: PendingSyncRow): Promise<boolean> {
    const result = await this.sync(row.id, row.url, row.title, row.summary);
    return result.success;
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!(await this.isConfigured())) {
      return { success: false, message: 'GitHub PAT not configured' };
    }

    try {
      const settings = await new SettingsRepository().getAll();
      const pat = settings[StorageKeys.GITHUB_PAT] as string;

      const response = await fetchWithTimeout(`${GIST_API_BASE}/user`, {
        headers: {
          Authorization: `token ${pat}`,
          'User-Agent': 'yasumaro-extension',
          Accept: 'application/vnd.github.v3+json',
        },
        cache: CONNECTION_TEST_CACHE_MODE,
        skipCspValidation: true,
      });

      if (response.ok) {
        return { success: true, message: 'Connected to GitHub successfully' };
      }

      if (response.status === 401) {
        return { success: false, message: 'Invalid GitHub PAT (unauthorized)' };
      }

      return { success: false, message: `GitHub API error: ${response.status}` };
    } catch (error) {
      return {
        success: false,
        message: `Connection failed: ${errorMessage(error)}`,
      };
    }
  }

  private async createGist(content: string, pat: string): Promise<string> {
    const response = await fetchWithTimeout(`${GIST_API_BASE}/gists`, {
      method: 'POST',
      skipCspValidation: true,
      headers: {
        Authorization: `token ${pat}`,
        'User-Agent': 'yasumaro-extension',
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        description: 'Yasumaro browsing history',
        public: false,
        files: {
          'yasumaro-history.md': {
            content,
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`GitHub Gist creation failed: ${response.status}`);
    }

    const data = await readJsonCapped(response, 10 * 1024 * 1024) as { id: string };
    return data.id;
  }

  private async updateGist(gistId: string, content: string, pat: string): Promise<void> {
    const response = await fetchWithTimeout(`${GIST_API_BASE}/gists/${gistId}`, {
      method: 'PATCH',
      skipCspValidation: true,
      headers: {
        Authorization: `token ${pat}`,
        'User-Agent': 'yasumaro-extension',
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        files: {
          'yasumaro-history.md': {
            content,
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`GitHub Gist update failed: ${response.status}`);
    }
  }
}
