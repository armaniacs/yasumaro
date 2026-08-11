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
import type {
  OffscreenResponse,
  OffscreenInsertResponse,
  OffscreenCountResponse,
  OffscreenQueryResponse,
  OffscreenToggleStarResponse,
  OffscreenBinaryResponse,
  OffscreenStatusResponse,
  OffscreenStatusData,
  OffscreenPurgeResponse,
  OffscreenContentPurgeResponse,
  OffscreenOpfsSpikeResponse,
  OffscreenWriteResponse,
} from '../messaging/sqliteMessages.js';

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
          } else if (response && 'error' in response && response.error) {
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

  private async call<T, R extends OffscreenResponse = OffscreenResponse>(
    type: SqliteMessageType,
    payload: Record<string, unknown> = {},
    transform?: (res: Extract<R, { success: true }>) => T,
    traceId: string = '',
  ): Promise<CallResult<T>> {
    try {
      const res = await this.msgOffscreen(type, payload, traceId);
      if (!res?.success) {
        const msg = res && 'error' in res ? String(res.error) : `${type} failed`;
        recordSqliteFailure(type, msg);
        logError('SQLite Client: call failed', { error: msg, traceId }, ErrorCode.STORAGE_READ_FAILURE, 'sqlite');
        return { success: false, error: categorizeError(msg) };
      }
      recordSqliteSuccess();
      return { success: true, data: transform ? transform(res as Extract<R, { success: true }>) : (res as unknown as T) };
    } catch (error) {
      const msg = errorMessage(error);
      recordSqliteFailure(type, msg);
      logError('SQLite Client: call failed', { error: msg, traceId }, ErrorCode.STORAGE_READ_FAILURE, 'sqlite');
      return { success: false, error: categorizeError(msg) };
    }
  }

  async init(): Promise<boolean> {
    const result = await this.call('SQLITE_INIT');
    return result.success;
  }

  async insertResult(record: BrowsingLogRecord, traceId: string = ''): Promise<CallResult<{ id: number }>> {
    return this.call<{ id: number }, OffscreenInsertResponse>(
      'SQLITE_INSERT',
      record as unknown as Record<string, unknown>,
      (res) => ({ id: res.id }),
      traceId,
    );
  }

  async insertBatchResult(records: BrowsingLogRecord[]): Promise<CallResult<{ count: number }>> {
    return this.call<{ count: number }, OffscreenCountResponse>(
      'SQLITE_INSERT_BATCH',
      { records: records as unknown as Record<string, unknown>[] },
      (res) => ({ count: res.count }),
    );
  }

  // --------------------------------------------------------------------------
  // Read path
  //
  // These return CallResult so the failure reason travels with the call that
  // produced it. (PBI-02 removed the `null`-returning wrappers that discarded
  // that reason.)
  // --------------------------------------------------------------------------

  async queryResult<T = BrowsingLogRecord>(options: QueryOptions = {}): Promise<CallResult<{ rows: T[]; total: number }>> {
    return this.call<{ rows: T[]; total: number }, OffscreenQueryResponse>(
      'SQLITE_QUERY',
      options as unknown as Record<string, unknown>,
      (res) => ({
        rows: (res.rows || []) as T[],
        total: res.total,
      }),
    );
  }

  async searchResult(query: string, limit = 50, offset = 0): Promise<CallResult<{ rows: SearchResult[]; total: number }>> {
    return this.call<{ rows: SearchResult[]; total: number }, OffscreenQueryResponse>(
      'SQLITE_SEARCH',
      { query, limit, offset },
      (res) => ({
        rows: (res.rows || []) as SearchResult[],
        total: res.total,
      }),
    );
  }

  async updateResult(id: number, changes: Partial<Record<string, unknown>>, traceId: string = ''): Promise<CallResult<void>> {
    return this.call<void, OffscreenWriteResponse>('SQLITE_UPDATE', { id, ...changes }, () => undefined, traceId);
  }

  async deleteResult(id: number): Promise<CallResult<void>> {
    return this.call<void, OffscreenWriteResponse>('SQLITE_DELETE', { id }, () => undefined);
  }

  async toggleStarResult(id: number): Promise<CallResult<{ is_starred: number }>> {
    return this.call<{ is_starred: number }, OffscreenToggleStarResponse>(
      'SQLITE_TOGGLE_STAR',
      { id },
      (res) => ({ is_starred: res.is_starred }),
    );
  }

  async getCountResult(): Promise<CallResult<number>> {
    return this.call<number, OffscreenCountResponse>('SQLITE_COUNT', {}, (res) => {
      if (!Number.isFinite(res.count)) {
        throw new Error('SQLite count response was missing a numeric count');
      }
      return res.count;
    });
  }

  async exportDbResult(): Promise<CallResult<Uint8Array>> {
    return this.call<Uint8Array, OffscreenBinaryResponse>(
      'SQLITE_EXPORT',
      {},
      (res) => new Uint8Array(res.data),
    );
  }

  async backupDbResult(): Promise<CallResult<Uint8Array>> {
    return this.call<Uint8Array, OffscreenBinaryResponse>(
      'SQLITE_BACKUP',
      {},
      (res) => new Uint8Array(res.data),
    );
  }

  async restoreDbResult(data: Uint8Array): Promise<CallResult<void>> {
    return this.call<void, OffscreenWriteResponse>('SQLITE_RESTORE', { data: Array.from(data) }, () => undefined);
  }

  async getStatus(): Promise<Omit<OffscreenStatusData, 'success'> | null> {
    const result = await this.call<Omit<OffscreenStatusData, 'success'>, OffscreenStatusResponse>(
      'SQLITE_STATUS',
      {},
      (res) => ({
        initialized: res.initialized,
        path: res.path,
        fallback: res.fallback,
        fts5: res.fts5,
        initError: res.initError,
        compileOptions: res.compileOptions,
        compileOptionsSource: res.compileOptionsSource,
        opfsMigrationV2Done: res.opfsMigrationV2Done,
        opfsMigrationV2LastAttemptedAt: res.opfsMigrationV2LastAttemptedAt,
        opfsMigrationV2CompletedAt: res.opfsMigrationV2CompletedAt,
        opfsMigrationV2RecordCount: res.opfsMigrationV2RecordCount,
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
    return this.call<void, OffscreenWriteResponse>('SQLITE_CLEAR_ALL', {}, () => undefined);
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
    return this.call<OpfsSpikeReport, OffscreenOpfsSpikeResponse>(
      'SQLITE_OPFS_SPIKE',
      {},
      (res) => res.report,
    );
  }

  async purgeOldRecordsResult(retentionDays?: number, maxRecords?: number): Promise<CallResult<{ purged: number }>> {
    return this.call<{ purged: number }, OffscreenPurgeResponse>(
      'SQLITE_PURGE',
      { retentionDays, maxRecords },
      (res) => ({ purged: res.purged }),
    );
  }

  async purgeContentResult(
    retentionDays?: number,
    maxRecords?: number,
    includeStarred?: boolean,
  ): Promise<CallResult<{ purged: number }>> {
    return this.call<{ purged: number }, OffscreenContentPurgeResponse>(
      'CONTENT_PURGE',
      { retentionDays, maxRecords, includeStarred },
      (res) => ({ purged: res.purged }),
    );
  }

  async insertAuditLogResult(record: { provider: string; url: string; created_at: number }): Promise<CallResult<{ id: number }>> {
    return this.call<{ id: number }, OffscreenInsertResponse>(
      'SQLITE_AUDIT_LOG_INSERT',
      record,
      (res) => ({ id: res.id }),
    );
  }

  async queryAuditLogResult(options: { limit?: number; offset?: number } = {}): Promise<CallResult<{ rows: Array<{ id: number; provider: string; url: string; created_at: number }>; total: number }>> {
    return this.call<{ rows: Array<{ id: number; provider: string; url: string; created_at: number }>; total: number }, OffscreenQueryResponse>(
      'SQLITE_AUDIT_LOG_QUERY',
      options as unknown as Record<string, unknown>,
      (res) => ({
        rows: (res.rows || []) as Array<{ id: number; provider: string; url: string; created_at: number }>,
        total: res.total,
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
