/**
 * dashboardSqliteService.ts
 * Provides SQLite-backed data access for the dashboard via SW message passing.
 * The service worker's DASHBOARD_SQLITE handler proxies requests to SqliteClient.
 */

const DASHBOARD_SQLITE_TIMEOUT = 10000;
const CONFIRM_TOKEN_KEY = 'dashboardSqliteConfirmToken';

interface DashboardResponse<T = unknown> {
  success: boolean;
  error?: string;
  rows?: T[];
  total?: number;
  count?: number;
  is_starred?: number;
  [key: string]: unknown;
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

async function withConfirmToken(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const confirmToken = await getConfirmToken();
  return confirmToken ? { ...payload, confirmToken } : payload;
}

async function sendDashboardMessage(
  payload: Record<string, unknown>,
  options: { requireConfirmToken?: boolean } = {}
): Promise<DashboardResponse> {
  const messagePayload = options.requireConfirmToken
    ? await withConfirmToken(payload)
    : payload;

  return new Promise<DashboardResponse>((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'DASHBOARD_SQLITE', payload: messagePayload },
      (response: DashboardResponse) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      }
    );

    setTimeout(() => {
      reject(new Error('Dashboard SQLite request timed out'));
    }, DASHBOARD_SQLITE_TIMEOUT);
  });
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
} = {}): Promise<{ rows: BrowsingLogEntry[]; total: number } | null> {
  try {
    const response = await sendDashboardMessage({ subtype: 'query', ...options });
    if (response.success) {
      return { rows: (response.rows || []) as BrowsingLogEntry[], total: Number(response.total || 0) };
    }
    return null;
  } catch (error) {
    console.error('queryLogs failed:', error);
    return null;
  }
}

/**
 * FTS5 full-text search.
 */
export async function searchLogs(
  query: string,
  limit = 50,
  offset = 0
): Promise<{ rows: BrowsingLogEntry[]; total: number } | null> {
  try {
    const response = await sendDashboardMessage({ subtype: 'search', query, limit, offset });
    if (response.success) {
      return { rows: (response.rows || []) as BrowsingLogEntry[], total: Number(response.total || 0) };
    }
    return null;
  } catch (error) {
    console.error('searchLogs failed:', error);
    return null;
  }
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
 */
export async function getSqliteStatus(): Promise<{ initialized: boolean; path: string; fallback: boolean } | null> {
  try {
    const response = await sendDashboardMessage({ subtype: 'status' });
    if (response.success) {
      return {
        initialized: Boolean(response.initialized),
        path: String(response.path || ''),
        fallback: Boolean(response.fallback),
      };
    }
    return null;
  } catch (error) {
    console.error('getSqliteStatus failed:', error);
    return null;
  }
}
