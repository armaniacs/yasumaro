/**
 * gistSyncTarget.ts
 * EXPERIMENTAL GitHub Gist sync target implementation.
 * Syncs browsing history entries to a GitHub Gist as Markdown.
 *
 * Batch-policy note (PBI 2026-10-24-05): the batch loop folded here from
 * SyncBatchRunner is an internal seam of this file, not a shared abstraction
 * (sole SyncTarget adapter, N=1).
 * RE-EXTRACT CONDITION: extract a shared runner again only when a second
 * SyncTarget adapter appears and duplicates this loop.
 */

import type { SyncTarget } from './SyncTarget.js';
import { SqliteClient } from '../sqlite/offscreenGateway.js';
import { LogType } from '../../utils/logger/types.js';
import { addLog } from '../../utils/logger/core.js';
import { errorMessage } from '../../utils/errorUtils.js';
import { settingsRepository, type SettingsReader, type SettingsRepository } from '../../utils/storage/SettingsRepository.js';
import { StorageKeys } from '../../utils/storage/types.js';
import { buildEntryMarkdown } from '../../utils/markdownFormatter.js';
import { CONNECTION_TEST_CACHE_MODE, fetchWithTimeout, noRedirectInit } from '../../utils/fetch.js';
import { readJsonCapped } from '../../utils/readBodyCapped.js';
import { isCredentialConfigured } from './settingsConfiguredCheck.js';
import { describeHttpFailure } from '../../utils/httpFailureMessages.js';

const GIST_API_BASE = 'https://api.github.com';

/** Log label for this target; the batch seam reports under this name. */
const GIST_SYNC_TARGET_NAME = 'GistSync';

/** Rows fetched per batch iteration. Policy lives here with its sole consumer. */
const GIST_BATCH_SIZE = 50;

/** Hard cap guarding against unbounded loops when pending rows keep arriving. */
const GIST_MAX_BATCH_ITERATIONS = 100;

/** Minimal row shape the internal batch seam needs to drive one sync call. */
interface PendingGistRow {
  id: number;
  url: string;
  title: string | null;
  summary: string | null;
}

/**
 * Minimal read+write settings port for GistSyncTarget.
 * WHY: SettingsReader is read-only (getMany/getAll) but sync() must persist
 * GIST_ID after creating a gist. Widening the seam by just `set` (option A)
 * keeps `new GistSyncTarget(sqliteClient)` callers source-compatible because
 * the shared SettingsRepository instance already satisfies this type.
 */
export type GistSettingsStore = SettingsReader & Pick<SettingsRepository, 'set'>;

export class GistSyncTarget implements SyncTarget {
  private sqliteClient: SqliteClient;
  private settingsReader: GistSettingsStore;

  constructor(sqliteClient: SqliteClient, settingsReader: GistSettingsStore = settingsRepository) {
    this.sqliteClient = sqliteClient;
    this.settingsReader = settingsReader;
  }

  async isConfigured(): Promise<boolean> {
    return isCredentialConfigured(this.settingsReader, StorageKeys.GITHUB_PAT, 1);
  }

  async sync(logId: number, url: string, title: string | null, summary: string | null, markdown?: string): Promise<{ success: boolean; error?: string }> {
    if (!(await this.isConfigured())) {
      return { success: false };
    }

    try {
      const settings = await this.settingsReader.getAll();
      const pat = settings[StorageKeys.GITHUB_PAT] as string;
      const gistId = settings[StorageKeys.GIST_ID] as string | undefined;
      // Single-line entry via the entry-markdown SSOT (PBI-04). The legacy
      // behavior is reproduced, not unified: no summary normalization and no
      // fallback (a missing summary omits the suffix instead of pinning one).
      const defaultEntry = () =>
        buildEntryMarkdown({ title, url, summary }, 'plainLine', {
          normalizeSummary: false,
          summaryFallback: null,
        });
      const entry = markdown || defaultEntry();

      if (gistId) {
        // Update existing Gist
        await this.updateGist(gistId, entry, pat);
      } else {
        // Create new Gist
        const newGistId = await this.createGist(entry, pat);
        await this.settingsReader.set(StorageKeys.GIST_ID, newGistId);
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

    return this.runBatchLoop();
  }

  /**
   * Internal batch seam (folded from SyncBatchRunner, PBI 2026-10-24-05).
   * Fetches up to GIST_BATCH_SIZE pending rows, syncs each, and repeats until
   * no rows remain or GIST_MAX_BATCH_ITERATIONS is reached.
   * Returns the total number of rows successfully synced.
   */
  private async runBatchLoop(): Promise<number> {
    let totalSynced = 0;

    try {
      for (let iteration = 0; iteration < GIST_MAX_BATCH_ITERATIONS; iteration++) {
        const rows = await this.listPending(GIST_BATCH_SIZE);
        if (rows.length === 0) {
          break;
        }

        let batchSynced = 0;
        for (const row of rows) {
          const success = await this.syncRow(row);
          if (success) {
            batchSynced++;
          }
        }

        totalSynced += batchSynced;

        // WHY: rows are re-queried each iteration (not paged via offset), so when
        // the backlog is unbounded batchSynced === 0 (all attempts failed) must stop
        // the loop -- otherwise the same unsynced rows would be refetched forever.
        if (batchSynced === 0) {
          break;
        }
      }

      if (totalSynced > 0) {
        addLog(LogType.INFO, `${GIST_SYNC_TARGET_NAME}: batch completed`, { synced: totalSynced });
      }

      return totalSynced;
    } catch (error) {
      addLog(LogType.WARN, `${GIST_SYNC_TARGET_NAME}: batch failed`, {
        error: errorMessage(error),
      });
      throw error;
    }
  }

  /** Internal batch seam: fetches up to `limit` unsynced rows. */
  private async listPending(limit: number): Promise<PendingGistRow[]> {
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

  /** Internal batch seam: syncs one row (sync() itself marks it via sqliteClient.mutate). */
  private async syncRow(row: PendingGistRow): Promise<boolean> {
    const result = await this.sync(row.id, row.url, row.title, row.summary);
    return result.success;
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!(await this.isConfigured())) {
      return { success: false, message: 'GitHub PAT not configured' };
    }

    try {
      const settings = await this.settingsReader.getAll();
      const pat = settings[StorageKeys.GITHUB_PAT] as string;

      // PBI 2026-10-19-06: this request carries the PAT. A 30x must not be
      // followed — even a same-origin one keeps the header, and a cross-origin
      // Location would leak it to a host no gate checked.
      // PBI 2026-10-21-11: no skipCspValidation — api.github.com is declared
      // always in host_permissions (GIST_EGRESS_HOST_PERMISSIONS) and allowed
      // by the runtime gate, so the fetch runs through the standard CSP gate.
      const response = await fetchWithTimeout(`${GIST_API_BASE}/user`, noRedirectInit({
        headers: {
          Authorization: `token ${pat}`,
          'User-Agent': 'yasumaro-extension',
          Accept: 'application/vnd.github.v3+json',
        },
        cache: CONNECTION_TEST_CACHE_MODE,
      }));

      if (response.ok) {
        return { success: true, message: 'Connected to GitHub successfully' };
      }

      if (response.status === 401) {
        return { success: false, message: describeHttpFailure(response.status, 'GitHub') };
      }

      return { success: false, message: describeHttpFailure(response.status, 'GitHub') };
    } catch (error) {
      return {
        success: false,
        message: `Connection failed: ${errorMessage(error)}`,
      };
    }
  }

  private async createGist(content: string, pat: string): Promise<string> {
    // PBI 2026-10-19-06: the PAT rides along, so a 30x must not be followed.
    // PBI 2026-10-21-11: no skipCspValidation — the standard CSP gate runs.
    const response = await fetchWithTimeout(`${GIST_API_BASE}/gists`, noRedirectInit({
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
    }));

    if (!response.ok) {
      throw new Error(`GitHub Gist creation failed: ${response.status}`);
    }

    const data = await readJsonCapped(response, 10 * 1024 * 1024) as { id: string };
    return data.id;
  }

  private async updateGist(gistId: string, content: string, pat: string): Promise<void> {
    // PBI 2026-10-19-06: same policy as the create/connection-test sites.
    // PBI 2026-10-21-11: no skipCspValidation — the standard CSP gate runs.
    const response = await fetchWithTimeout(`${GIST_API_BASE}/gists/${gistId}`, noRedirectInit({
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
    }));

    if (!response.ok) {
      throw new Error(`GitHub Gist update failed: ${response.status}`);
    }
  }
}
