/**
 * gistSyncTarget.ts
 * GitHub Gist sync target implementation.
 * Syncs browsing history entries to a GitHub Gist as Markdown.
 */

import type { SyncTarget } from './SyncTarget.js';
import { SqliteClient } from '../sqliteClient.js';
import { addLog, LogType } from '../../utils/logger.js';
import { errorMessage } from '../../utils/errorUtils.js';
import { StorageKeys, getSettings, saveSettings } from '../../utils/storage.js';
import type { Settings } from '../../utils/storage/types.js';

const GIST_API_BASE = 'https://api.github.com';

export class GistSyncTarget implements SyncTarget {
  private sqliteClient: SqliteClient;

  constructor(sqliteClient: SqliteClient) {
    this.sqliteClient = sqliteClient;
  }

  async isConfigured(): Promise<boolean> {
    try {
      const settings = await getSettings();
      const pat = settings[StorageKeys.GITHUB_PAT] as string | undefined;
      return typeof pat === 'string' && pat.length > 0;
    } catch {
      return false;
    }
  }

  async sync(logId: number, url: string, title: string | null, summary: string | null, markdown?: string): Promise<{ success: boolean; error?: string }> {
    if (!(await this.isConfigured())) {
      return { success: false };
    }

    try {
      const settings = await getSettings();
      const pat = settings[StorageKeys.GITHUB_PAT] as string;
      const gistId = settings[StorageKeys.GIST_ID] as string | undefined;
      const entry = markdown || `- [${title || url}](${url})${summary ? `: ${summary}` : ''}`;

      if (gistId) {
        // Update existing Gist
        await this.updateGist(gistId, entry, pat);
      } else {
        // Create new Gist
        const newGistId = await this.createGist(entry, pat);
        await saveSettings({ [StorageKeys.GIST_ID]: newGistId } as Partial<Settings> as Settings);
      }

      await this.sqliteClient.update(logId, { gist_synced: 1 });
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

    const BATCH_SIZE = 50;
    const MAX_ITERATIONS = 100;

    try {
      let totalSynced = 0;

        for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
            const result = await this.sqliteClient.query({
                limit: BATCH_SIZE,
                offset: 0,
                orderBy: 'created_at',
                orderDir: 'DESC',
                gistSynced: 0,
            });

            if (!result || !result.rows || result.rows.length === 0) {
                break;
            }

            let batchSynced = 0;
            for (const row of result.rows) {
                if (row.id === undefined) continue;
                const syncResult = await this.sync(row.id, row.url, row.title ?? null, row.summary ?? null);
                if (syncResult.success) {
                    batchSynced++;
                }
            }

            totalSynced += batchSynced;
        }

      if (totalSynced > 0) {
        addLog(LogType.INFO, 'GistSync: batch completed', { synced: totalSynced });
      }

      return totalSynced;
    } catch (error) {
      addLog(LogType.WARN, 'GistSync: batch failed', {
        error: errorMessage(error),
      });
      return 0;
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!(await this.isConfigured())) {
      return { success: false, message: 'GitHub PAT not configured' };
    }

    try {
      const settings = await getSettings();
      const pat = settings[StorageKeys.GITHUB_PAT] as string;

      const response = await fetch(`${GIST_API_BASE}/user`, {
        headers: {
          Authorization: `token ${pat}`,
          'User-Agent': 'yasumaro-extension',
          Accept: 'application/vnd.github.v3+json',
        },
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
    const response = await fetch(`${GIST_API_BASE}/gists`, {
      method: 'POST',
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

    const data = await response.json() as { id: string };
    return data.id;
  }

  private async updateGist(gistId: string, content: string, pat: string): Promise<void> {
    const response = await fetch(`${GIST_API_BASE}/gists/${gistId}`, {
      method: 'PATCH',
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
