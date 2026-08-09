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

/**
 * What kind of failure this was.
 *
 * The raw input is still a string — Chrome extension APIs report errors as
 * messages, not typed exceptions (ADR 2026-07-13, assumption G). What changed
 * is that the classification survives: it used to be folded straight into an
 * English sentence and discarded, so callers wanting to know "is this worth
 * retrying?" had to pattern-match the prose back out again.
 */
export type SqliteErrorKind =
  | 'timeout'         // request timed out; the DB may still be initializing
  | 'offscreen_lost'  // offscreen document went away
  | 'quota'           // storage quota exceeded
  | 'sqlite_error'    // SQLite itself reported a problem
  | 'unknown';

export interface SqliteError {
  kind: SqliteErrorKind;
  /** User-facing message. Unchanged from the pre-classification wording. */
  message: string;
  /**
   * Whether retrying the same call could plausibly succeed.
   *
   * Only timeouts qualify: the offscreen document plus WASM load can outrun
   * the first query after the dashboard opens. Quota and SQLite errors are
   * deterministic, and a lost offscreen document needs a reload, so retrying
   * those just delays the error the user needs to see.
   */
  retriable: boolean;
}

export type CallResult<T> = { success: true; data: T } | { success: false; error: SqliteError };

export function categorizeError(msg: string): SqliteError {
  if (msg.includes('timed out') || msg.includes('Timeout')) {
    return {
      kind: 'timeout',
      message: 'SQLite request timed out. The database may still be initializing.',
      retriable: true,
    };
  }
  if (msg.includes('offscreen') || msg.includes('offscreenDocument')) {
    return {
      kind: 'offscreen_lost',
      message: 'Database connection lost. Please reload the extension.',
      retriable: false,
    };
  }
  if (msg.includes('quota') || msg.includes('QuotaExceededError')) {
    return {
      kind: 'quota',
      message: 'Storage quota exceeded. Some older records may have been removed.',
      retriable: false,
    };
  }
  if (msg.includes('SQLITE_') || msg.includes('disk I/O')) {
    return { kind: 'sqlite_error', message: `Database error: ${msg}`, retriable: false };
  }
  return { kind: 'unknown', message: `Unexpected error: ${msg}`, retriable: false };
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

  /**
   * Last categorized error from call().
   *
   * This is shared mutable state: it describes "the most recent failure by
   * anyone", not "why *your* call failed". Reading it after a call can observe
   * a different operation's error, or null, if another operation completed in
   * between — the read is outside the request Mutex.
   *
   * Read-path methods therefore return their error in CallResult instead. This
   * field remains for the write-path handlers and for diagnostic logging,
   * which only need a best-effort "what went wrong recently".
   */
  lastErrorDetail: SqliteError | null = null;

  /** Backwards-compatible view of {@link lastErrorDetail} for existing readers. */
  get lastError(): string | null {
    return this.lastErrorDetail?.message ?? null;
  }

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
        this.lastErrorDetail = categorizeError(msg);
        return { success: false, error: this.lastErrorDetail };
      }
      recordSqliteSuccess();
      this.lastErrorDetail = null;
      return { success: true, data: transform ? transform(res) : (res as unknown as T) };
    } catch (error) {
      const msg = errorMessage(error);
      recordSqliteFailure(type, msg);
      logError('SQLite Client: call failed', { error: msg, traceId }, ErrorCode.STORAGE_READ_FAILURE, 'sqlite');
      this.lastErrorDetail = categorizeError(msg);
      return { success: false, error: this.lastErrorDetail };
    }
  }

  async init(): Promise<boolean> {
    const result = await this.call('SQLITE_INIT');
    return result.success;
  }

  async insertResult(record: BrowsingLogRecord, traceId: string = ''): Promise<CallResult<{ id: number }>> {
    return this.call<{ id: number }>(
      'SQLITE_INSERT',
      record as unknown as Record<string, unknown>,
      (res) => ({ id: Number(res.id) }),
      traceId,
    );
  }

  async insert(record: BrowsingLogRecord, traceId: string = ''): Promise<{ id: number } | null> {
    const result = await this.insertResult(record, traceId);
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

  // --------------------------------------------------------------------------
  // Read path
  //
  // These return CallResult so the failure reason travels with the call that
  // produced it. The `null`-returning variants below are kept for callers that
  // genuinely only need "did it work", and are defined in terms of these.
  // --------------------------------------------------------------------------

  async queryResult<T = BrowsingLogRecord>(options: QueryOptions = {}): Promise<CallResult<{ rows: T[]; total: number }>> {
    return this.call<{ rows: T[]; total: number }>(
      'SQLITE_QUERY',
      options as unknown as Record<string, unknown>,
      (res) => ({
        rows: (res.rows || []) as T[],
        total: Number(res.total || 0),
      }),
    );
  }

  async query<T = BrowsingLogRecord>(options: QueryOptions = {}): Promise<{ rows: T[]; total: number } | null> {
    const result = await this.queryResult<T>(options);
    return result.success ? result.data : null;
  }

  async searchResult(query: string, limit = 50, offset = 0): Promise<CallResult<{ rows: SearchResult[]; total: number }>> {
    return this.call<{ rows: SearchResult[]; total: number }>(
      'SQLITE_SEARCH',
      { query, limit, offset },
      (res) => ({
        rows: (res.rows || []) as SearchResult[],
        total: Number(res.total || 0),
      }),
    );
  }

  async search(query: string, limit = 50, offset = 0): Promise<{ rows: SearchResult[]; total: number } | null> {
    const result = await this.searchResult(query, limit, offset);
    return result.success ? result.data : null;
  }

  async updateResult(id: number, changes: Partial<Record<string, unknown>>, traceId: string = ''): Promise<CallResult<void>> {
    return this.call('SQLITE_UPDATE', { id, ...changes }, undefined, traceId);
  }

  async update(id: number, changes: Partial<Record<string, unknown>>, traceId: string = ''): Promise<boolean> {
    const result = await this.updateResult(id, changes, traceId);
    return result.success;
  }

  async deleteResult(id: number): Promise<CallResult<void>> {
    return this.call('SQLITE_DELETE', { id });
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.deleteResult(id);
    return result.success;
  }

  async toggleStarResult(id: number): Promise<CallResult<{ is_starred: number }>> {
    return this.call<{ is_starred: number }>(
      'SQLITE_TOGGLE_STAR',
      { id },
      (res) => ({ is_starred: Number(res.is_starred) }),
    );
  }

  async toggleStar(id: number): Promise<{ is_starred: number } | null> {
    const result = await this.toggleStarResult(id);
    return result.success ? result.data : null;
  }

  async getCountResult(): Promise<CallResult<number>> {
    return this.call<number>('SQLITE_COUNT', {}, (res) => Number(res.count));
  }

  async getCount(): Promise<number | null> {
    const result = await this.getCountResult();
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

  async backupDbResult(): Promise<CallResult<Uint8Array>> {
    return this.call<Uint8Array>(
      'SQLITE_BACKUP',
      {},
      (res) => new Uint8Array(res.data as number[]),
    );
  }

  async backupDb(): Promise<Uint8Array | null> {
    const result = await this.backupDbResult();
    return result.success ? result.data : null;
  }

  async restoreDbResult(data: Uint8Array): Promise<CallResult<void>> {
    return this.call('SQLITE_RESTORE', { data: Array.from(data) });
  }

  async restoreDb(data: Uint8Array): Promise<boolean> {
    const result = await this.restoreDbResult(data);
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
      initError: result.error.message || 'Unknown error',
      compileOptionsSource: undefined,
    };
  }

  async clearAllResult(): Promise<CallResult<void>> {
    return this.call('SQLITE_CLEAR_ALL');
  }

  async clearAll(): Promise<boolean> {
    const result = await this.clearAllResult();
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

  async runOpfsSpikeResult(): Promise<CallResult<OpfsSpikeReport>> {
    return this.call<OpfsSpikeReport>(
      'SQLITE_OPFS_SPIKE',
      {},
      (res) => res.report as OpfsSpikeReport,
    );
  }

  async runOpfsSpike(): Promise<OpfsSpikeReport | null> {
    const result = await this.runOpfsSpikeResult();
    return result.success ? result.data : null;
  }

  async purgeOldRecordsResult(retentionDays?: number, maxRecords?: number): Promise<CallResult<{ purged: number }>> {
    return this.call<{ purged: number }>(
      'SQLITE_PURGE',
      { retentionDays, maxRecords },
      (res) => ({ purged: Number(res.purged || 0) }),
    );
  }

  async purgeOldRecords(retentionDays?: number, maxRecords?: number): Promise<{ purged: number } | null> {
    const result = await this.purgeOldRecordsResult(retentionDays, maxRecords);
    return result.success ? result.data : null;
  }

  async purgeContentResult(
    retentionDays?: number,
    maxRecords?: number,
    includeStarred?: boolean,
  ): Promise<CallResult<{ purged: number }>> {
    return this.call<{ purged: number }>(
      'CONTENT_PURGE',
      { retentionDays, maxRecords, includeStarred },
      (res) => ({ purged: Number(res.purged || 0) }),
    );
  }

  async purgeContent(
    retentionDays?: number,
    maxRecords?: number,
    includeStarred?: boolean,
  ): Promise<{ purged: number } | null> {
    const result = await this.purgeContentResult(retentionDays, maxRecords, includeStarred);
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

  async queryAuditLogResult(options: { limit?: number; offset?: number } = {}): Promise<CallResult<{ rows: Array<{ id: number; provider: string; url: string; created_at: number }>; total: number }>> {
    return this.call<{ rows: Array<{ id: number; provider: string; url: string; created_at: number }>; total: number }>(
      'SQLITE_AUDIT_LOG_QUERY',
      options as unknown as Record<string, unknown>,
      (res) => ({
        rows: (res.rows || []) as Array<{ id: number; provider: string; url: string; created_at: number }>,
        total: Number(res.total || 0),
      }),
    );
  }

  async queryAuditLog(options: { limit?: number; offset?: number } = {}): Promise<{ rows: Array<{ id: number; provider: string; url: string; created_at: number }>; total: number } | null> {
    const result = await this.queryAuditLogResult(options);
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
