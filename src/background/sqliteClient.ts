/**
 * sqliteClient.ts
 * Service Worker side client for SQLite operations.
 * Communicates with the Offscreen Document via message passing (target: 'offscreen').
 *
 * Pattern: src/background/localAiClient.ts
 */

import { addLog, LogType, logError, ErrorCode } from '../utils/logger.js';
import { errorMessage } from '../utils/errorUtils.js';
import { recordSqliteFailure, recordSqliteSuccess } from './sqliteAlert.js';
import { Mutex } from '../utils/Mutex.js';
import { getPlatformOs } from '../utils/deviceUtils.js';
import type { SqliteMessageType } from '../messaging/sqliteMessages.js';

const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
const MESSAGE_TIMEOUT_MS_DESKTOP = 10000; // 10 seconds
// Mobile Chrome suspends the offscreen document more aggressively when idle,
// so a shorter timeout surfaces the resulting failure sooner instead of
// leaving the caller waiting the full desktop timeout.
const MESSAGE_TIMEOUT_MS_MOBILE = 5000; // 5 seconds

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

type CallResult<T> = { success: true; data: T } | { success: false; error: string };

function categorizeError(msg: string): string {
  if (msg.includes('timed out') || msg.includes('Timeout')) {
    return 'SQLite request timed out. The database may still be initializing.';
  }
  if (msg.includes('offscreen') || msg.includes('offscreenDocument')) {
    return 'Database connection lost. Please reload the extension.';
  }
  if (msg.includes('quota') || msg.includes('QuotaExceededError')) {
    return 'Storage quota exceeded. Some older records may have been removed.';
  }
  if (msg.includes('SQLITE_') || msg.includes('disk I/O')) {
    return `Database error: ${msg}`;
  }
  return `Unexpected error: ${msg}`;
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

  /** Last categorized error from call(). Read by dashboard handlers. */
  lastError: string | null = null;

  /** Per-message timeout, shortened on mobile (see MESSAGE_TIMEOUT_MS_MOBILE). */
  private readonly messageTimeoutMs: number;

  constructor() {
    this.creatingOffscreenPromise = null;
    this.offscreenAlive = false;
    const os = getPlatformOs();
    const isMobile = os === 'android' || os === 'ios';
    // Reduce the queue size on mobile devices to limit memory consumption.
    const maxQueueSize = isMobile ? 50 : 200;
    this.messageTimeoutMs = isMobile ? MESSAGE_TIMEOUT_MS_MOBILE : MESSAGE_TIMEOUT_MS_DESKTOP;
    this.requestQueue = new Mutex({ maxQueueSize, timeoutMs: this.messageTimeoutMs * 2 });
  }

  /**
   * Ensure the offscreen document is open.
   * Uses the same dedup pattern previously shared with LocalAIClient (now BuiltInAIClient,
   * which no longer needs an offscreen document since it calls LanguageModel directly).
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
  private async sendOnce(
    type: SqliteMessageType,
    payload: Record<string, unknown>,
    traceId: string = ''
  ): Promise<OffscreenResponse> {
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
        settle(() => reject(new Error(`Offscreen message '${type}' timed out after ${this.messageTimeoutMs}ms`)));
      }, this.messageTimeoutMs);

      chrome.runtime.sendMessage(
        { type, target: 'offscreen', payload, traceId },
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
  async msgOffscreen(
    type: SqliteMessageType,
    payload: Record<string, unknown> = {},
    traceId: string = ''
  ): Promise<OffscreenResponse> {
    await this.requestQueue.acquire();
    try {
      try {
        return await this.sendOnce(type, payload, traceId);
      } catch (firstError) {
        this.offscreenAlive = false;
        addLog(LogType.WARN, `SqliteClient: '${type}' failed, retrying once`, {
          error: errorMessage(firstError),
          traceId,
        });
        return await this.sendOnce(type, payload, traceId);
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
    type: SqliteMessageType,
    payload: Record<string, unknown> = {},
    transform?: (res: OffscreenResponse) => T,
    traceId: string = '',
  ): Promise<CallResult<T>> {
    try {
      const res = await this.msgOffscreen(type, payload, traceId);
      if (!res?.success) {
        const msg = String(res?.error || `${type} failed`);
        recordSqliteFailure(type, msg);
        logError('SQLite Client: call failed', { error: msg, traceId }, ErrorCode.STORAGE_READ_FAILURE, 'sqlite');
        this.lastError = categorizeError(msg);
        return { success: false, error: this.lastError };
      }
      recordSqliteSuccess();
      this.lastError = null;
      return { success: true, data: transform ? transform(res) : (res as unknown as T) };
    } catch (error) {
      const msg = errorMessage(error);
      recordSqliteFailure(type, msg);
      logError('SQLite Client: call failed', { error: msg, traceId }, ErrorCode.STORAGE_READ_FAILURE, 'sqlite');
      this.lastError = categorizeError(msg);
      return { success: false, error: this.lastError };
    }
  }

  async init(): Promise<boolean> {
    const result = await this.call('SQLITE_INIT');
    return result.success;
  }

  async insert(record: BrowsingLogRecord, traceId: string = ''): Promise<{ id: number } | null> {
    const result = await this.call<{ id: number }>(
      'SQLITE_INSERT',
      record as unknown as Record<string, unknown>,
      (res) => ({ id: Number(res.id) }),
      traceId,
    );
    return result.success ? result.data : null;
  }

  async insertBatch(records: BrowsingLogRecord[]): Promise<{ count: number } | null> {
    const result = await this.call<{ count: number }>(
      'SQLITE_INSERT_BATCH',
      { records: records as unknown as Record<string, unknown>[] },
      (res) => ({ count: Number(res.count) }),
    );
    return result.success ? result.data : null;
  }

  async query<T = BrowsingLogRecord>(options: QueryOptions = {}): Promise<{ rows: T[]; total: number } | null> {
    const result = await this.call<{ rows: T[]; total: number }>(
      'SQLITE_QUERY',
      options as unknown as Record<string, unknown>,
      (res) => ({
        rows: (res.rows || []) as T[],
        total: Number(res.total || 0),
      }),
    );
    return result.success ? result.data : null;
  }

  async search(query: string, limit = 50, offset = 0): Promise<{ rows: SearchResult[]; total: number } | null> {
    const result = await this.call<{ rows: SearchResult[]; total: number }>(
      'SQLITE_SEARCH',
      { query, limit, offset },
      (res) => ({
        rows: (res.rows || []) as SearchResult[],
        total: Number(res.total || 0),
      }),
    );
    return result.success ? result.data : null;
  }

  async update(id: number, changes: Partial<Record<string, unknown>>, traceId: string = ''): Promise<boolean> {
    const result = await this.call('SQLITE_UPDATE', { id, ...changes }, undefined, traceId);
    return result.success;
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.call('SQLITE_DELETE', { id });
    return result.success;
  }

  async toggleStar(id: number): Promise<{ is_starred: number } | null> {
    const result = await this.call<{ is_starred: number }>(
      'SQLITE_TOGGLE_STAR',
      { id },
      (res) => ({ is_starred: Number(res.is_starred) }),
    );
    return result.success ? result.data : null;
  }

  async getCount(): Promise<number | null> {
    const result = await this.call<number>('SQLITE_COUNT', {}, (res) => Number(res.count));
    return result.success ? result.data : null;
  }

  async exportDb(): Promise<Uint8Array | null> {
    const result = await this.call<Uint8Array>(
      'SQLITE_EXPORT',
      {},
      (res) => new Uint8Array(res.data as number[]),
    );
    return result.success ? result.data : null;
  }

  async backupDb(): Promise<Uint8Array | null> {
    const result = await this.call<Uint8Array>(
      'SQLITE_BACKUP',
      {},
      (res) => new Uint8Array(res.data as number[]),
    );
    return result.success ? result.data : null;
  }

  async restoreDb(data: Uint8Array): Promise<boolean> {
    const result = await this.call('SQLITE_RESTORE', { data: Array.from(data) });
    return result.success;
  }

  async getStatus(): Promise<{ initialized: boolean; path: string; fallback: boolean; fts5?: boolean; initError?: string; compileOptions?: string[]; compileOptionsSource?: 'opfs-worker' | 'idb' | 'fallback' } | null> {
    const result = await this.call<{ initialized: boolean; path: string; fallback: boolean; fts5?: boolean; initError?: string; compileOptions?: string[]; compileOptionsSource?: 'opfs-worker' | 'idb' | 'fallback' }>(
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
    if (result.success) {
      return result.data;
    }
    // Even on failure, return diagnostic info so the UI can display it
    return {
      initialized: false,
      path: '',
      fallback: false,
      fts5: false,
      initError: result.error || 'Unknown error',
      compileOptionsSource: undefined,
    };
  }

  async clearAll(): Promise<boolean> {
    const result = await this.call('SQLITE_CLEAR_ALL');
    return result.success;
  }

  /** Run the OPFS feasibility spike (PBI-10) in the offscreen document. */
  /**
   * Lightweight health check — verifies offscreen SQLite is reachable and responsive.
   * Performs a `SELECT 1` equivalent via the offscreen document.
   */
  async isSqliteHealthy(): Promise<boolean> {
    const result = await this.call('SQLITE_HEALTH_CHECK', {});
    return result.success;
  }

  async runOpfsSpike(): Promise<OpfsSpikeReport | null> {
    const result = await this.call<OpfsSpikeReport>(
      'SQLITE_OPFS_SPIKE',
      {},
      (res) => res.report as OpfsSpikeReport,
    );
    return result.success ? result.data : null;
  }

  async purgeOldRecords(retentionDays?: number, maxRecords?: number): Promise<{ purged: number } | null> {
    const result = await this.call<{ purged: number }>(
      'SQLITE_PURGE',
      { retentionDays, maxRecords },
      (res) => ({ purged: Number(res.purged || 0) }),
    );
    return result.success ? result.data : null;
  }

  async purgeContent(
    retentionDays?: number,
    maxRecords?: number,
    includeStarred?: boolean,
  ): Promise<{ purged: number } | null> {
    const result = await this.call<{ purged: number }>(
      'CONTENT_PURGE',
      { retentionDays, maxRecords, includeStarred },
      (res) => ({ purged: Number(res.purged || 0) }),
    );
    return result.success ? result.data : null;
  }

  async insertAuditLog(record: { provider: string; url: string; created_at: number }): Promise<{ id: number } | null> {
    const result = await this.call<{ id: number }>(
      'SQLITE_AUDIT_LOG_INSERT',
      record,
      (res) => ({ id: Number(res.id) }),
    );
    return result.success ? result.data : null;
  }

  async queryAuditLog(options: { limit?: number; offset?: number } = {}): Promise<{ rows: Array<{ id: number; provider: string; url: string; created_at: number }>; total: number } | null> {
    const result = await this.call<{ rows: Array<{ id: number; provider: string; url: string; created_at: number }>; total: number }>(
      'SQLITE_AUDIT_LOG_QUERY',
      options as unknown as Record<string, unknown>,
      (res) => ({
        rows: (res.rows || []) as Array<{ id: number; provider: string; url: string; created_at: number }>,
        total: Number(res.total || 0),
      }),
    );
    return result.success ? result.data : null;
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
