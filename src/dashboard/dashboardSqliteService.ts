/**
 * dashboardSqliteService.ts
 * Provides SQLite-backed data access for the dashboard via SW message passing.
 * The service worker's DASHBOARD_SQLITE handler proxies requests to SqliteClient.
 */

import type { DashboardSqliteRequest, DashboardSqliteResponseFor } from '../background/handlers/dashboardSqliteProtocol.js';
import { CURRENT_PROTOCOL_VERSION } from '../background/messageTypes.js';

const DASHBOARD_SQLITE_TIMEOUT = 10000;
const CONFIRM_TOKEN_KEY = 'dashboardSqliteConfirmToken';

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
      // On first failure, wait briefly for SQLite to initialize and retry
      if (attempt === 0 && response.error && String(response.error).includes('Query failed')) {
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
      console.error('queryLogs failed:', error instanceof Error ? error.message : String(error));
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
      if (attempt === 0 && response.error && String(response.error).includes('Search failed')) {
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
      console.error('searchLogs failed:', error instanceof Error ? error.message : String(error));
      return null;
    }
  }
  return { error: 'Search failed' };
}

/**
 * Toggle the star status of a log entry.
 */
export async function toggleStar(id: number): Promise<{ is_starred: number } | null> {
  try {
    const response = await sendDashboardMessage({ subtype: 'toggle_star', id }, { requireConfirmToken: true });
    if (response.success) {
      return { is_starred: Number(response.is_starred) };
    }
    return null;
  } catch (error) {
    console.error('toggleStar failed:', error);
    return null;
  }
}

/**
 * Soft-delete a log entry.
 */
export async function deleteLog(id: number): Promise<boolean> {
  try {
    const response = await sendDashboardMessage({ subtype: 'delete', id }, { requireConfirmToken: true });
    return response.success === true;
  } catch (error) {
    console.error('deleteLog failed:', error);
    return false;
  }
}

/**
 * Update a log entry's fields.
 */
export async function updateLog(id: number, changes: Record<string, unknown>): Promise<boolean> {
  try {
    const response = await sendDashboardMessage({ subtype: 'update', id, changes }, { requireConfirmToken: true });
    return response.success === true;
  } catch (error) {
    console.error('updateLog failed:', error);
    return false;
  }
}

/**
 * Force re-run the chrome.storage → SQLite migration.
 * Returns the SQLite record count after migration, or null on failure.
 */
export async function migrateLogs(): Promise<{ count: number; read: number; inserted: number } | null> {
  try {
    const response = await sendDashboardMessage({ subtype: 'migrate' }, { requireConfirmToken: true });
    if (response.success) {
      return {
        count: Number(response.count || 0),
        read: Number(response.read || 0),
        inserted: Number(response.inserted || 0),
      };
    }
    return null;
  } catch (error) {
    console.error('migrateLogs failed:', error);
    return null;
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
export async function runOpfsSpike(): Promise<OpfsSpikeReportView | null> {
  try {
    const response = await sendDashboardMessage({ subtype: 'opfs_spike' });
    if (response.success && response.report) {
      return response.report as OpfsSpikeReportView;
    }
    return null;
  } catch (error) {
    console.error('runOpfsSpike failed:', error);
    return null;
  }
}

export async function clearAllLogs(): Promise<boolean> {
  try {
    const response = await sendDashboardMessage({ subtype: 'clear_all' }, { requireConfirmToken: true });
    return response.success === true;
  } catch (error) {
    console.error('clearAllLogs failed:', error);
    return false;
  }
}

/**
 * Get total record count.
 */
export async function getLogCount(): Promise<number> {
  try {
    const response = await sendDashboardMessage({ subtype: 'get_count' });
    if (response.success) {
      return Number(response.count || 0);
    }
    return 0;
  } catch {
    return 0;
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
      initError: error instanceof Error ? error.message : String(error),
    };
  }
}


/**
 * Explicitly clean up legacy chrome.storage keys.
 * This is a destructive operation - only call after user confirmation.
 */
export async function cleanupLegacyStorage(): Promise<{ removed: string[]; totalBytes: number } | null> {
  try {
    const response = await sendDashboardMessage(
      { subtype: 'cleanup_legacy' },
      { requireConfirmToken: true }
    );
    if (response.success) {
      return {
        removed: Array.isArray(response.removed) ? response.removed : [],
        totalBytes: Number(response.totalBytes || 0),
      };
    }
    return null;
  } catch (error) {
    console.error('cleanupLegacyStorage failed:', error);
    return null;
  }
}

/**
 * Backfill diagnostic metadata for already-migrated SQLite entries
 * that are missing metric fields (sent_tokens, page_bytes, etc.).
 */
export async function backfillMetadata(): Promise<{ updated: number; total: number } | null> {
  try {
    const response = await sendDashboardMessage(
      { subtype: 'backfill_metadata' },
      { requireConfirmToken: true }
    );
    if (response.success) {
      return {
        updated: Number(response.updated || 0),
        total: Number(response.total || 0),
      };
    }
    return null;
  } catch (error) {
    console.error('backfillMetadata failed:', error);
    return null;
  }
}

/**
 * バイナリ .db バックアップを取得
 */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export async function backupDb(): Promise<Uint8Array | null> {
  try {
    const response = await sendDashboardMessage({ subtype: 'backup_db' });
    if (response.success && response.data) {
      return base64ToBytes(response.data as string);
    }
    return null;
  } catch (error) {
    console.error('backupDb failed:', error);
    return null;
  }
}

/**
 * Restore the entire history database from a binary snapshot.
 * Requires a confirmation token (destructive operation).
 */
export async function restoreDb(data: Uint8Array): Promise<boolean> {
  try {
    const response = await sendDashboardMessage(
      { subtype: 'restore_db', data: bytesToBase64(data) },
      { requireConfirmToken: true }
    );
    return Boolean(response.success);
  } catch (error) {
    console.error('restoreDb failed:', error);
    return false;
  }
}

/**
 * Import browsing log rows into SQLite.
 */
export async function importLogs(rows: Array<{
  url: string; title?: string; summary?: string; tags?: string;
  created_at: number; domain?: string; visit_duration?: number;
  scroll_ratio?: number; is_starred?: number; is_deleted?: number;
}>): Promise<{ inserted: number; skipped: number; total: number } | null> {
  try {
    const response = await sendDashboardMessage(
      { subtype: 'import', rows },
      { requireConfirmToken: true }
    );
    if (response.success) {
      return {
        inserted: Number(response.inserted || 0),
        skipped: Number(response.skipped || 0),
        total: Number(response.total || 0),
      };
    }
    return null;
  } catch (error) {
    console.error('importLogs failed:', error);
    return null;
  }
}

/**
 * Append selected log entries to Obsidian daily note.
 * Read-only on SQLite — no confirm token needed.
 */
export async function appendToLogs(ids: number[]): Promise<{ success: boolean; appended?: number; error?: string } | null> {
  try {
    const response = await sendDashboardMessage({ subtype: 'append_to_obsidian', ids });
    if (response.success) {
      return { success: true, appended: Number(response.appended || ids.length) };
    }
    return { success: false, error: response.error ? String(response.error) : 'Append failed' };
  } catch (error) {
    console.error('appendToLogs failed:', error);
    return null;
  }
}

/**
 * Query audit log entries (cloud AI provider send events).
 * Read-only on SQLite — no confirm token needed.
 */
export async function queryAuditLogs(
  options: { limit?: number; offset?: number } = {}
): Promise<{ rows: Array<{ id: number; provider: string; url: string; created_at: number }>; total: number } | null> {
  try {
    const response = await sendDashboardMessage({ subtype: 'audit_log_query', ...options });
    if (response.success) {
      return {
        rows: (response.rows || []) as Array<{ id: number; provider: string; url: string; created_at: number }>,
        total: Number(response.total || 0),
      };
    }
    console.warn('queryAuditLogs failed:', String(response.error || 'Unknown error'));
    return null;
  } catch (error) {
    console.error('queryAuditLogs failed:', error);
    return null;
  }
}
