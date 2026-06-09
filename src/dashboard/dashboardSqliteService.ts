/**
 * dashboardSqliteService.ts
 * Provides SQLite-backed data access for the dashboard via SW message passing.
 * The service worker's DASHBOARD_SQLITE handler proxies requests to SqliteClient.
 */

const DASHBOARD_SQLITE_TIMEOUT = 10000;

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
function sendDashboardMessage(payload: Record<string, unknown>): Promise<DashboardResponse> {
  return new Promise<DashboardResponse>((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'DASHBOARD_SQLITE', payload },
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

export interface BrowsingLogEntry {
  id: number;
  url: string;
  title: string | null;
  summary: string | null;
  tags: string | null;
  created_at: number;
  domain: string | null;
  visit_duration: number | null;
  scroll_ratio: number | null;
  is_starred: number;
}

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
    const response = await sendDashboardMessage({ subtype: 'toggle_star', id });
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
    const response = await sendDashboardMessage({ subtype: 'delete', id });
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
    const response = await sendDashboardMessage({ subtype: 'update', id, changes });
    return response.success === true;
  } catch (error) {
    console.error('updateLog failed:', error);
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
