/**
 * sqliteClient.ts
 * Service Worker side client for SQLite operations.
 * Communicates with the Offscreen Document via message passing (target: 'offscreen').
 *
 * Pattern: src/background/localAiClient.ts
 */

import { addLog, LogType } from '../utils/logger.js';
import { errorMessage } from '../utils/errorUtils.js';
import { recordSqliteFailure, recordSqliteSuccess } from './sqliteAlert.js';
import { Mutex } from './Mutex.js';

const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
const MESSAGE_TIMEOUT_MS = 10000; // 10 seconds

// ============================================================================
// Types
// ============================================================================

import type { BrowsingLogRecord, QueryOptions, SearchResult } from '../utils/sqlite-types.js';
import type { OpfsSpikeReport } from '../offscreen/opfsSpike.js';

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
  fallback?: boolean;
  [key: string]: unknown;
}

// ============================================================================
// SqliteClient
// ============================================================================

export class SqliteClient {
  private creatingOffscreenPromise: Promise<void> | null;
  /** Cached knowledge that the offscreen document is alive. Reset on error. */
  private offscreenAlive: boolean;
  /**
   * Serializes requests to the offscreen document (M7). The offscreen
   * document processes one SQLite operation at a time; without this,
   * overlapping requests from multiple tabs would race each other.
   */
  private readonly requestQueue: Mutex;

  constructor() {
    this.creatingOffscreenPromise = null;
    this.offscreenAlive = false;
    this.requestQueue = new Mutex({ maxQueueSize: 200, timeoutMs: MESSAGE_TIMEOUT_MS * 2 });
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
      reasons: [chrome.offscreen.Reason.WORKERS, chrome.offscreen.Reason.LOCAL_STORAGE],
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
   * Send a single message to the offscreen document and await the response.
   * Does not retry — callers needing reconnect-on-failure should use msgOffscreen().
   */
  private async sendOnce(type: string, payload: Record<string, unknown>): Promise<OffscreenResponse> {
    await this.ensureOffscreenDocument();
    return new Promise<OffscreenResponse>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        fn();
      };
      const timeoutId = setTimeout(() => {
        settle(() => reject(new Error(`Offscreen message '${type}' timed out after ${MESSAGE_TIMEOUT_MS}ms`)));
      }, MESSAGE_TIMEOUT_MS);

      chrome.runtime.sendMessage(
        { type, target: 'offscreen', payload },
        (response: OffscreenResponse) => {
          if (chrome.runtime.lastError) {
            settle(() => reject(new Error(chrome.runtime.lastError?.message ?? 'Unknown error')));
          } else if (response && response.error) {
            settle(() => reject(new Error(response.error)));
          } else {
            settle(() => resolve(response));
          }
        }
      );
    });
  }

  /**
   * Send a message to the offscreen document and await the response.
   *
   * Retries once on failure (M12): a mobile Chrome offscreen document can be
   * suspended between requests, so the first attempt after idle may fail
   * with a connection error. Resetting offscreenAlive and recreating the
   * document lets the retry succeed instead of surfacing a transient error.
   */
  async msgOffscreen(type: string, payload: Record<string, unknown> = {}): Promise<OffscreenResponse> {
    await this.requestQueue.acquire();
    try {
      try {
        return await this.sendOnce(type, payload);
      } catch (firstError) {
        this.offscreenAlive = false;
        addLog(LogType.WARN, `SqliteClient: '${type}' failed, retrying once`, { error: errorMessage(firstError) });
        return await this.sendOnce(type, payload);
      }
    } catch (error) {
      // Reset the cached alive flag so the next call re-checks the document.
      this.offscreenAlive = false;
      throw error;
    } finally {
      this.requestQueue.release();
    }
  }

  private async call<T>(
    type: string,
    payload: Record<string, unknown> = {},
    transform?: (res: OffscreenResponse) => T,
  ): Promise<T | null> {
    try {
      const response = await this.msgOffscreen(type, payload);
      if (response?.success) {
        recordSqliteSuccess();
        return transform ? transform(response) : (response as unknown as T);
      }
      recordSqliteFailure(type, response?.error || 'unknown');
      return null;
    } catch (error: unknown) {
      addLog(LogType.ERROR, `SqliteClient: ${type} failed`, { error: errorMessage(error) });
      recordSqliteFailure(type, errorMessage(error));
      return null;
    }
  }

  async init(): Promise<boolean> {
    return (await this.call<void>('SQLITE_INIT')) !== null;
  }

  async insert(record: BrowsingLogRecord): Promise<{ id: number } | null> {
    return this.call<{ id: number }>(
      'SQLITE_INSERT',
      record as unknown as Record<string, unknown>,
      (res) => ({ id: Number(res.id) }),
    );
  }

  async insertBatch(records: BrowsingLogRecord[]): Promise<{ count: number } | null> {
    return this.call<{ count: number }>(
      'SQLITE_INSERT_BATCH',
      { records: records as unknown as Record<string, unknown>[] },
      (res) => ({ count: Number(res.count) }),
    );
  }

  async query<T = BrowsingLogRecord>(options: QueryOptions = {}): Promise<{ rows: T[]; total: number } | null> {
    return this.call<{ rows: T[]; total: number }>(
      'SQLITE_QUERY',
      options as unknown as Record<string, unknown>,
      (res) => ({
        rows: (res.rows || []) as T[],
        total: Number(res.total || 0),
      }),
    );
  }

  async search(query: string, limit = 50, offset = 0): Promise<{ rows: SearchResult[]; total: number } | null> {
    return this.call<{ rows: SearchResult[]; total: number }>(
      'SQLITE_SEARCH',
      { query, limit, offset },
      (res) => ({
        rows: (res.rows || []) as SearchResult[],
        total: Number(res.total || 0),
      }),
    );
  }

  async update(id: number, changes: Partial<Record<string, unknown>>): Promise<boolean> {
    return (await this.call<void>('SQLITE_UPDATE', { id, ...changes })) !== null;
  }

  async delete(id: number): Promise<boolean> {
    return (await this.call<void>('SQLITE_DELETE', { id })) !== null;
  }

  async toggleStar(id: number): Promise<{ is_starred: number } | null> {
    return this.call<{ is_starred: number }>(
      'SQLITE_TOGGLE_STAR',
      { id },
      (res) => ({ is_starred: Number(res.is_starred) }),
    );
  }

  async getCount(): Promise<number | null> {
    return this.call<number>('SQLITE_COUNT', {}, (res) => Number(res.count));
  }

  async exportDb(): Promise<Uint8Array | null> {
    return this.call<Uint8Array>(
      'SQLITE_EXPORT',
      {},
      (res) => new Uint8Array(res.data as number[]),
    );
  }

  async backupDb(): Promise<Uint8Array | null> {
    return this.call<Uint8Array>(
      'SQLITE_BACKUP',
      {},
      (res) => new Uint8Array(res.data as number[]),
    );
  }

  async restoreDb(data: Uint8Array): Promise<boolean> {
    try {
      const res = await this.msgOffscreen('SQLITE_RESTORE', { data: Array.from(data) });
      return Boolean(res.success);
    } catch (error) {
      console.error('restoreDb failed:', errorMessage(error));
      return false;
    }
  }

  async getStatus(): Promise<{ initialized: boolean; path: string; fallback: boolean; fts5?: boolean; initError?: string; compileOptions?: string[]; compileOptionsSource?: 'opfs-worker' | 'idb' | 'fallback' } | null> {
    return this.call<{ initialized: boolean; path: string; fallback: boolean; fts5?: boolean; initError?: string; compileOptions?: string[]; compileOptionsSource?: 'opfs-worker' | 'idb' | 'fallback' }>(
      'SQLITE_STATUS',
      {},
      (res) => ({
        initialized: Boolean(res.initialized),
        path: String(res.path || ''),
        fallback: Boolean(res.fallback),
        fts5: Boolean(res.fts5),
        initError: res.initError ? String(res.initError) : undefined,
        compileOptions: Array.isArray(res.compileOptions) ? res.compileOptions : undefined,
        compileOptionsSource: res.compileOptionsSource as 'opfs-worker' | 'idb' | 'fallback' | undefined,
      }),
    );
  }

  async clearAll(): Promise<boolean> {
    return (await this.call<void>('SQLITE_CLEAR_ALL')) !== null;
  }

  /** Run the OPFS feasibility spike (PBI-10) in the offscreen document. */
  /**
   * Lightweight health check — verifies offscreen SQLite is reachable and responsive.
   * Performs a `SELECT 1` equivalent via the offscreen document.
   */
  async isSqliteHealthy(): Promise<boolean> {
    try {
      const res = await this.msgOffscreen('SQLITE_HEALTH_CHECK', {});
      return res.success === true;
    } catch {
      return false;
    }
  }

  async runOpfsSpike(): Promise<OpfsSpikeReport | null> {
    return this.call<OpfsSpikeReport>(
      'SQLITE_OPFS_SPIKE',
      {},
      (res) => res.report as OpfsSpikeReport,
    );
  }

  async purgeOldRecords(retentionDays?: number, maxRecords?: number): Promise<{ purged: number } | null> {
    return this.call<{ purged: number }>(
      'SQLITE_PURGE',
      { retentionDays, maxRecords },
      (res) => ({ purged: Number(res.purged || 0) }),
    );
  }

  async purgeContent(
    retentionDays?: number,
    maxRecords?: number,
    includeStarred?: boolean,
  ): Promise<{ purged: number } | null> {
    return this.call<{ purged: number }>(
      'CONTENT_PURGE',
      { retentionDays, maxRecords, includeStarred },
      (res) => ({ purged: Number(res.purged || 0) }),
    );
  }

  async insertAuditLog(record: { provider: string; url: string; created_at: number }): Promise<{ id: number } | null> {
    return this.call<{ id: number }>(
      'SQLITE_AUDIT_LOG_INSERT',
      record,
      (res) => ({ id: Number(res.id) }),
    );
  }

  async queryAuditLog(options: { limit?: number; offset?: number } = {}): Promise<{ rows: Array<{ id: number; provider: string; url: string; created_at: number }>; total: number } | null> {
    return this.call<{ rows: Array<{ id: number; provider: string; url: string; created_at: number }>; total: number }>(
      'SQLITE_AUDIT_LOG_QUERY',
      options as unknown as Record<string, unknown>,
      (res) => ({
        rows: (res.rows || []) as Array<{ id: number; provider: string; url: string; created_at: number }>,
        total: Number(res.total || 0),
      }),
    );
  }
}

// ============================================================================
// Shared instance (M8)
// ============================================================================

let sharedInstance: SqliteClient | null = null;

/**
 * Returns a single, shared SqliteClient instance for the Service Worker
 * context. Each SqliteClient tracks offscreen-document lifecycle state
 * (`offscreenAlive`); independent instances would each redundantly check
 * and race to create the offscreen document. Callers that previously did
 * `new SqliteClient()` at module scope should use this instead.
 */
export function getSharedSqliteClient(): SqliteClient {
  if (!sharedInstance) {
    sharedInstance = new SqliteClient();
  }
  return sharedInstance;
}
