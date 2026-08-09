/**
 * dashboardSqliteService.ts
 * Provides SQLite-backed data access for the dashboard via SW message passing.
 * The service worker's DASHBOARD_SQLITE handler proxies requests to SqliteClient.
 */

import type { DashboardSqliteRequest, DashboardSqliteResponseFor } from '../background/handlers/dashboardSqliteProtocol.js';
import { CURRENT_PROTOCOL_VERSION } from '../background/messageTypes.js';
import { bytesToBase64, base64ToBytes } from '../utils/crypto/index.js';

const DASHBOARD_SQLITE_TIMEOUT = 10000;
const CONFIRM_TOKEN_KEY = 'dashboardSqliteConfirmToken';

/**
 * The uniform failure shape for this module.
 *
 * The same "it failed" used to arrive as `null`, `false`, `-1` or `{error}`
 * depending on which function you happened to call, so every call site had to
 * remember a different idiom — and the three silent shapes carried no reason
 * to show the user.
 *
 * The success side is `{ data }` rather than `{ ok: true, data }` to match the
 * `{ ... } | { error }` functions that PBI-19/21 already migrated; adding an
 * `ok` discriminant here would have made a third idiom instead of removing one.
 */
export type ServiceResult<T> = { data: T } | { error: string };

/** Narrowing helper so call sites do not each re-derive the check. */
export function isServiceError<T>(result: ServiceResult<T>): result is { error: string } {
  return 'error' in result;
}

/**
 * Send a DASHBOARD_SQLITE message to the service worker.
 */
async function getConfirmToken(): Promise<string | null> {
  try {
    const stored = await chrome.storage.session.get(CONFIRM_TOKEN_KEY) as Record<string, string | undefined>;
    if (stored[CONFIRM_TOKEN_KEY]) {
      return stored[CONFIRM_TOKEN_KEY];
    }
  } catch (error) {
    console.error('Failed to read dashboard SQLite confirmToken:', error);
  }

  try {
    const response = await sendDashboardMessage({ subtype: 'confirm_token' });
    if (response.success && typeof response.confirmToken === 'string') {
      await chrome.storage.session.set({ [CONFIRM_TOKEN_KEY]: response.confirmToken });
      return response.confirmToken;
    }
  } catch (error) {
    console.error('Failed to request dashboard SQLite confirmToken:', error);
  }

  return null;
}

async function withConfirmToken<T extends DashboardSqliteRequest>(payload: T): Promise<T & { confirmToken?: string }> {
  const confirmToken = await getConfirmToken();
  return confirmToken ? { ...payload, confirmToken } : payload;
}

async function sendDashboardMessage<T extends DashboardSqliteRequest>(
  payload: T,
  options: { requireConfirmToken?: boolean } = {}
): Promise<DashboardSqliteResponseFor<T['subtype']>> {
  const messagePayload = options.requireConfirmToken
    ? await withConfirmToken(payload)
    : payload;

  // Use Promise-based API (MV3) with timeout for reliability.
  // The callback-based API can silently fail with chrome.runtime.lastError
  // when the service worker responds async via sendResponse().
  return Promise.race([
    chrome.runtime.sendMessage({ type: 'DASHBOARD_SQLITE', protocolVersion: CURRENT_PROTOCOL_VERSION, payload: messagePayload }),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Dashboard SQLite request timed out')), DASHBOARD_SQLITE_TIMEOUT);
    }),
  ]);
}

// ============================================================================
// Public API
// ============================================================================

import type { BrowsingLogEntry } from '../utils/sqlite-types.js';
import { errorMessage } from '../utils/errorUtils.js';
export type { BrowsingLogEntry };

export interface DateCount {
  date: string; // YYYY-MM-DD
  count: number;
}

/**
 * Query browsing logs with date range and filters.
 * Retries once on first failure to handle SQLite initialization timing.
 */
export async function queryLogs(options: {
  limit?: number;
  offset?: number;
  domain?: string;
  isStarred?: boolean;
  since?: number;
  until?: number;
  orderBy?: string;
  orderDir?: 'ASC' | 'DESC';
  tagFilter?: string;
} = {}): Promise<{ rows: BrowsingLogEntry[]; total: number } | { error: string } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await sendDashboardMessage({ subtype: 'query', ...options });
      if (response.success) {
        return { rows: (response.rows || []) as BrowsingLogEntry[], total: Number(response.total || 0) };
      }
      // Retry only when the service worker says the failure is transient.
      // This used to match the message text for 'Query failed', which is the
      // fallback wording used when no specific error was available — so the
      // retry stopped firing as soon as errors became specific.
      if (attempt === 0 && response.retriable) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      console.warn('queryLogs failed:', String(response.error || 'Unknown error'));
      return { error: String(response.error || 'Query failed') };
    } catch (error) {
      if (attempt === 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      console.error('queryLogs failed:', errorMessage(error));
      return null;
    }
  }
  return { error: 'Query failed' };
}

/**
 * FTS5 full-text search.
 * Retries once on first failure to handle SQLite initialization timing.
 */
export async function searchLogs(
  query: string,
  limit = 50,
  offset = 0
): Promise<{ rows: BrowsingLogEntry[]; total: number } | { error: string } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await sendDashboardMessage({ subtype: 'search', query, limit, offset });
      if (response.success) {
        return { rows: (response.rows || []) as BrowsingLogEntry[], total: Number(response.total || 0) };
      }
      // See queryLogs: retriability now comes from the service worker's
      // error classification rather than the wording of the message.
      if (attempt === 0 && response.retriable) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      console.warn('searchLogs failed:', String(response.error || 'Unknown error'));
      return { error: String(response.error || 'Search failed') };
    } catch (error) {
      if (attempt === 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      console.error('searchLogs failed:', errorMessage(error));
      return null;
    }
  }
  return { error: 'Search failed' };
}

/**
 * Toggle the star status of a log entry.
 *
 * Returns the reason on failure rather than null: the caller renders it, and
 * a bare null left the UI silent — pressing the star simply did nothing when
 * the database was unavailable (PBI-21).
 */
export async function toggleStar(id: number): Promise<ServiceResult<{ is_starred: number }>> {
  try {
    const response = await sendDashboardMessage({ subtype: 'toggle_star', id }, { requireConfirmToken: true });
    if (response.success) {
      return { data: { is_starred: Number(response.is_starred) } };
    }
    return { error: String(response.error || 'Toggle star failed') };
  } catch (error) {
    console.error('toggleStar failed:', errorMessage(error));
    return { error: errorMessage(error) };
  }
}

/**
 * Soft-delete a log entry.
 *
 * See toggleStar: the failure reason travels to the caller so the UI can
 * show it instead of appearing to ignore the click.
 */
export async function deleteLog(id: number): Promise<ServiceResult<void>> {
  try {
    const response = await sendDashboardMessage({ subtype: 'delete', id }, { requireConfirmToken: true });
    if (response.success) {
      return { data: undefined };
    }
    return { error: String(response.error || 'Delete failed') };
  } catch (error) {
    console.error('deleteLog failed:', errorMessage(error));
    return { error: errorMessage(error) };
  }
}

/**
 * Update a log entry's fields.
 */
export async function updateLog(id: number, changes: Record<string, unknown>): Promise<ServiceResult<void>> {
  try {
    const response = await sendDashboardMessage({ subtype: 'update', id, changes }, { requireConfirmToken: true });
    if (response.success === true) {
      return { data: undefined };
    }
    return { error: String(response.error || 'Update failed') };
  } catch (error) {
    console.error('updateLog failed:', errorMessage(error));
    return { error: errorMessage(error) };
  }
}

/**
 * Force re-run the chrome.storage → SQLite migration.
 * Returns the SQLite record count after migration, or null on failure.
 */
export async function migrateLogs(): Promise<ServiceResult<{ count: number; read: number; inserted: number }>> {
  try {
    const response = await sendDashboardMessage({ subtype: 'migrate' }, { requireConfirmToken: true });
    if (response.success) {
      return {
        data: {
          count: Number(response.count || 0),
          read: Number(response.read || 0),
          inserted: Number(response.inserted || 0),
        },
      };
    }
    return { error: String(response.error || 'Migration failed') };
  } catch (error) {
    console.error('migrateLogs failed:', errorMessage(error));
    return { error: errorMessage(error) };
  }
}

export interface OpfsSpikeStepResult { name: string; ok: boolean; detail: string }
export interface OpfsSpikeReportView {
  strategy: string;
  steps: OpfsSpikeStepResult[];
  passed: boolean;
  durationMs: number;
}

/**
 * Run the OPFS feasibility spike (PBI-10) and return its structured report.
 * Used by the diagnostics panel for manual verification in real Chrome.
 */
export async function runOpfsSpike(): Promise<ServiceResult<OpfsSpikeReportView>> {
  try {
    const response = await sendDashboardMessage({ subtype: 'opfs_spike' });
    if (response.success && response.report) {
      return { data: response.report as OpfsSpikeReportView };
    }
    return { error: response.success ? 'OPFS spike returned no report' : String(response.error || 'OPFS spike failed') };
  } catch (error) {
    console.error('runOpfsSpike failed:', errorMessage(error));
    return { error: errorMessage(error) };
  }
}

export async function clearAllLogs(): Promise<ServiceResult<void>> {
  try {
    const response = await sendDashboardMessage({ subtype: 'clear_all' }, { requireConfirmToken: true });
    if (response.success === true) {
      return { data: undefined };
    }
    return { error: String(response.error || 'Clear all failed') };
  } catch (error) {
    console.error('clearAllLogs failed:', errorMessage(error));
    return { error: errorMessage(error) };
  }
}

/**
 * Get total record count.
 * Returns -1 on error to distinguish from a legitimate count of 0.
 */
export async function getLogCount(): Promise<number> {
  try {
    const response = await sendDashboardMessage({ subtype: 'get_count' });
    if (response.success) {
      return Number(response.count || 0);
    }
    return -1;
  } catch {
    return -1;
  }
}

/**
 * Get SQLite status including fallback mode flag.
 * Returns diagnostic info even on failure so the UI can display it.
 */
export async function getSqliteStatus(): Promise<{
  initialized: boolean;
  path: string;
  fallback: boolean;
  fts5: boolean;
  compileOptions?: string[];
  compileOptionsSource?: 'opfs-worker' | 'idb' | 'fallback';
  initError?: string;
  opfsMigrationV2Done?: boolean;
  opfsMigrationV2LastAttemptedAt?: string | null;
  opfsMigrationV2CompletedAt?: string | null;
  opfsMigrationV2RecordCount?: number;
}> {
  try {
    const response = await sendDashboardMessage({ subtype: 'status' });
    if (response.success) {
      return {
        initialized: Boolean(response.initialized),
        path: String(response.path || ''),
        fallback: Boolean(response.fallback),
        fts5: Boolean(response.fts5),
        compileOptions: Array.isArray(response.compileOptions) ? response.compileOptions : undefined,
        compileOptionsSource: response.compileOptionsSource as 'opfs-worker' | 'idb' | 'fallback' | undefined,
        initError: response.initError ? String(response.initError) : undefined,
        opfsMigrationV2Done: response.opfsMigrationV2Done,
        opfsMigrationV2LastAttemptedAt: response.opfsMigrationV2LastAttemptedAt ?? null,
        opfsMigrationV2CompletedAt: response.opfsMigrationV2CompletedAt ?? null,
        opfsMigrationV2RecordCount: response.opfsMigrationV2RecordCount ?? 0,
      };
    }
    return {
      initialized: false,
      path: '',
      fallback: false,
      fts5: false,
      initError: String(response.error || 'Failed to get SQLite status'),
    };
  } catch (error) {
    return {
      initialized: false,
      path: '',
      fallback: false,
      fts5: false,
      initError: errorMessage(error),
    };
  }
}


/**
 * Explicitly clean up legacy chrome.storage keys.
 * This is a destructive operation - only call after user confirmation.
 */
export async function cleanupLegacyStorage(): Promise<ServiceResult<{ removed: string[]; totalBytes: number }>> {
  try {
    const response = await sendDashboardMessage(
      { subtype: 'cleanup_legacy' },
      { requireConfirmToken: true }
    );
    if (response.success) {
      return {
        data: {
          removed: Array.isArray(response.removed) ? response.removed : [],
          totalBytes: Number(response.totalBytes || 0),
        },
      };
    }
    return { error: String(response.error || 'Cleanup failed') };
  } catch (error) {
    console.error('cleanupLegacyStorage failed:', errorMessage(error));
    return { error: errorMessage(error) };
  }
}

/**
 * Backfill diagnostic metadata for already-migrated SQLite entries
 * that are missing metric fields (sent_tokens, page_bytes, etc.).
 */
export async function backfillMetadata(): Promise<ServiceResult<{ updated: number; total: number }>> {
  try {
    const response = await sendDashboardMessage(
      { subtype: 'backfill_metadata' },
      { requireConfirmToken: true }
    );
    if (response.success) {
      return {
        data: {
          updated: Number(response.updated || 0),
          total: Number(response.total || 0),
        },
      };
    }
    return { error: String(response.error || 'Backfill failed') };
  } catch (error) {
    console.error('backfillMetadata failed:', errorMessage(error));
    return { error: errorMessage(error) };
  }
}

/**
 * バイナリ .db バックアップを取得
 */
export async function backupDb(): Promise<ServiceResult<Uint8Array>> {
  try {
    const response = await sendDashboardMessage(
      { subtype: 'backup_db' },
      { requireConfirmToken: true },
    );
    if (response.success && response.data) {
      return { data: base64ToBytes(response.data as string) };
    }
    // A failed backup must not look like "nothing to back up" — the caller
    // would otherwise offer the user an empty or missing file as success.
    const message = response.success
      ? 'Backup returned no data'
      : String(response.error || 'Backup failed');
    console.warn('backupDb failed:', message);
    return { error: message };
  } catch (error) {
    console.error('backupDb failed:', errorMessage(error));
    return { error: errorMessage(error) };
  }
}

/**
 * Restore the entire history database from a binary snapshot.
 * Requires a confirmation token (destructive operation).
 */
export async function restoreDb(data: Uint8Array): Promise<ServiceResult<void>> {
  try {
    const response = await sendDashboardMessage(
      { subtype: 'restore_db', data: bytesToBase64(data) },
      { requireConfirmToken: true }
    );
    if (response.success) {
      return { data: undefined };
    }
    return { error: String(response.error || 'Restore failed') };
  } catch (error) {
    console.error('restoreDb failed:', errorMessage(error));
    return { error: errorMessage(error) };
  }
}

/**
 * Import browsing log rows into SQLite.
 */
export async function importLogs(rows: Array<{
  url: string; title?: string; summary?: string; tags?: string;
  created_at: number; domain?: string; visit_duration?: number;
  scroll_ratio?: number; is_starred?: number; is_deleted?: number;
}>): Promise<ServiceResult<{ inserted: number; skipped: number; total: number }>> {
  try {
    const response = await sendDashboardMessage(
      { subtype: 'import', rows },
      { requireConfirmToken: true }
    );
    if (response.success) {
      return {
        data: {
          inserted: Number(response.inserted || 0),
          skipped: Number(response.skipped || 0),
          total: Number(response.total || 0),
        },
      };
    }
    return { error: String(response.error || 'Import failed') };
  } catch (error) {
    console.error('importLogs failed:', errorMessage(error));
    return { error: errorMessage(error) };
  }
}

/**
 * Append selected log entries to Obsidian daily note.
 * Read-only on SQLite — no confirm token needed.
 */
export async function appendToLogs(ids: number[]): Promise<ServiceResult<{ appended: number }>> {
  try {
    const response = await sendDashboardMessage({ subtype: 'append_to_obsidian', ids });
    if (response.success) {
      return { data: { appended: Number(response.appended || ids.length) } };
    }
    return { error: response.error ? String(response.error) : 'Append failed' };
  } catch (error) {
    console.error('appendToLogs failed:', errorMessage(error));
    return { error: errorMessage(error) };
  }
}

/**
 * Query audit log entries (cloud AI provider send events).
 * Read-only on SQLite — no confirm token needed.
 */
export async function queryAuditLogs(
  options: { limit?: number; offset?: number } = {}
): Promise<{ rows: Array<{ id: number; provider: string; url: string; created_at: number }>; total: number } | { error: string } | null> {
  try {
    const response = await sendDashboardMessage({ subtype: 'audit_log_query', ...options });
    if (response.success) {
      return {
        rows: (response.rows || []) as Array<{ id: number; provider: string; url: string; created_at: number }>,
        total: Number(response.total || 0),
      };
    }
    // Return the reason rather than null: a caller that cannot tell "failed"
    // from "empty" reports a broken database as "no data".
    console.warn('queryAuditLogs failed:', String(response.error || 'Unknown error'));
    return { error: String(response.error || 'Audit log query failed') };
  } catch (error) {
    console.error('queryAuditLogs failed:', errorMessage(error));
    return null;
  }
}
