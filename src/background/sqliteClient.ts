/**
 * sqliteClient.ts
 * Service Worker side client for SQLite operations.
 * Communicates with the Offscreen Document via message passing (target: 'offscreen').
 *
 * Pattern: src/background/localAiClient.ts
 */

import { addLog, LogType } from '../utils/logger.js';

const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
const MESSAGE_TIMEOUT_MS = 10000; // 10 seconds

// ============================================================================
// Types
// ============================================================================

export interface BrowsingLogRecord {
  id?: number;
  url: string;
  title?: string | null;
  summary?: string | null;
  tags?: string | null;
  created_at: number;
  domain?: string | null;
  visit_duration?: number | null;
  scroll_ratio?: number | null;
  is_starred?: number;
  is_deleted?: number;
}

export interface QueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDir?: 'ASC' | 'DESC';
  domain?: string;
  isStarred?: boolean;
  excludeDeleted?: boolean;
  since?: number;
  until?: number;
}

export interface SearchResult {
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
  rank: number;
}

interface OffscreenResponse {
  success?: boolean;
  error?: string;
  initialized?: boolean;
  id?: number;
  rows?: unknown[];
  total?: number;
  count?: number;
  is_starred?: number;
  path?: string;
  [key: string]: unknown;
}

// ============================================================================
// SqliteClient
// ============================================================================

export class SqliteClient {
  private creatingOffscreenPromise: Promise<void> | null;
  /** Cached knowledge that the offscreen document is alive. Reset on error. */
  private offscreenAlive: boolean;

  constructor() {
    this.creatingOffscreenPromise = null;
    this.offscreenAlive = false;
  }

  /**
   * Ensure the offscreen document is open.
   * Uses the same dedup pattern as LocalAIClient.
   */
  async ensureOffscreenDocument(): Promise<void> {
    // Skip redundant browser IPC if we know the document is alive.
    if (this.offscreenAlive) return;

    const hasOffscreen = await chrome.offscreen.hasDocument();
    if (hasOffscreen) {
      this.offscreenAlive = true;
      return;
    }

    if (this.creatingOffscreenPromise) {
      await this.creatingOffscreenPromise;
      return;
    }

    this.creatingOffscreenPromise = chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'To access SQLite (wa-sqlite) for local browsing log storage.',
    });

    try {
      await this.creatingOffscreenPromise;
      this.offscreenAlive = true;
    } finally {
      this.creatingOffscreenPromise = null;
    }
  }

  /**
   * Send a message to the offscreen document and await the response.
   */
  async msgOffscreen(type: string, payload: Record<string, unknown> = {}): Promise<OffscreenResponse> {
    try {
      await this.ensureOffscreenDocument();
      return await new Promise<OffscreenResponse>((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type, target: 'offscreen', payload },
          (response: OffscreenResponse) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (response && response.error) {
              reject(new Error(response.error));
            } else {
              resolve(response);
            }
          }
        );

        // Timeout guard
        setTimeout(() => {
          reject(new Error(`Offscreen message '${type}' timed out after ${MESSAGE_TIMEOUT_MS}ms`));
        }, MESSAGE_TIMEOUT_MS);
      });
    } catch (error) {
      // Reset the cached alive flag so the next call re-checks the document.
      this.offscreenAlive = false;
      throw error;
    }
  }

  /**
   * Initialize the SQLite database. Safe to call multiple times.
   */
  async init(): Promise<boolean> {
    try {
      const response = await this.msgOffscreen('SQLITE_INIT');
      return response?.success === true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      addLog(LogType.ERROR, 'SqliteClient: init failed', { error: errorMessage });
      return false;
    }
  }

  /**
   * Insert a new browsing log record.
   */
  async insert(record: BrowsingLogRecord): Promise<{ id: number } | null> {
    try {
      const response = await this.msgOffscreen('SQLITE_INSERT', record as unknown as Record<string, unknown>);
      if (response?.success) {
        return { id: Number(response.id) };
      }
      return null;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      addLog(LogType.ERROR, 'SqliteClient: insert failed', { error: errorMessage });
      return null;
    }
  }

  /**
   * Query browsing logs with optional filters.
   */
  async query<T = BrowsingLogRecord>(options: QueryOptions = {}): Promise<{ rows: T[]; total: number } | null> {
    try {
      const response = await this.msgOffscreen('SQLITE_QUERY', options as unknown as Record<string, unknown>);
      if (response?.success) {
        return {
          rows: (response.rows || []) as T[],
          total: Number(response.total || 0),
        };
      }
      return null;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      addLog(LogType.ERROR, 'SqliteClient: query failed', { error: errorMessage });
      return null;
    }
  }

  /**
   * Full-text search using FTS5.
   */
  async search(query: string, limit = 50, offset = 0): Promise<{ rows: SearchResult[]; total: number } | null> {
    try {
      const response = await this.msgOffscreen('SQLITE_SEARCH', { query, limit, offset });
      if (response?.success) {
        return {
          rows: (response.rows || []) as SearchResult[],
          total: Number(response.total || 0),
        };
      }
      return null;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      addLog(LogType.ERROR, 'SqliteClient: search failed', { error: errorMessage });
      return null;
    }
  }

  /**
   * Update a browsing log record by id.
   */
  async update(id: number, changes: Partial<Record<string, unknown>>): Promise<boolean> {
    try {
      const response = await this.msgOffscreen('SQLITE_UPDATE', { id, ...changes });
      return response?.success === true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      addLog(LogType.ERROR, 'SqliteClient: update failed', { error: errorMessage });
      return false;
    }
  }

  /**
   * Soft-delete a record by id.
   */
  async delete(id: number): Promise<boolean> {
    try {
      const response = await this.msgOffscreen('SQLITE_DELETE', { id });
      return response?.success === true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      addLog(LogType.ERROR, 'SqliteClient: delete failed', { error: errorMessage });
      return false;
    }
  }

  /**
   * Toggle the starred status of a record.
   */
  async toggleStar(id: number): Promise<{ is_starred: number } | null> {
    try {
      const response = await this.msgOffscreen('SQLITE_TOGGLE_STAR', { id });
      if (response?.success) {
        return { is_starred: Number(response.is_starred) };
      }
      return null;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      addLog(LogType.ERROR, 'SqliteClient: toggleStar failed', { error: errorMessage });
      return null;
    }
  }

  /**
   * Get the total number of records.
   */
  async getCount(): Promise<number | null> {
    try {
      const response = await this.msgOffscreen('SQLITE_COUNT');
      if (response?.success) {
        return Number(response.count);
      }
      return null;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      addLog(LogType.ERROR, 'SqliteClient: getCount failed', { error: errorMessage });
      return null;
    }
  }

  /**
   * Export the database as a binary blob (.db format).
   */
  async exportDb(): Promise<Uint8Array | null> {
    try {
      const response = await this.msgOffscreen('SQLITE_EXPORT');
      if (response?.success && response.data) {
        return new Uint8Array(response.data as number[]);
      }
      return null;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      addLog(LogType.ERROR, 'SqliteClient: exportDb failed', { error: errorMessage });
      return null;
    }
  }

  /**
   * Get database status information.
   */
  async getStatus(): Promise<{ initialized: boolean; path: string } | null> {
    try {
      const response = await this.msgOffscreen('SQLITE_STATUS');
      if (response?.success) {
        return {
          initialized: Boolean(response.initialized),
          path: String(response.path || ''),
        };
      }
      return null;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      addLog(LogType.ERROR, 'SqliteClient: getStatus failed', { error: errorMessage });
      return null;
    }
  }
}
