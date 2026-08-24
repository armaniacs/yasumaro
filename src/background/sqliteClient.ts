/**
 * sqliteClient.ts
 * Service Worker side client for SQLite operations.
 * Communicates with the Offscreen Document via message passing (target: 'offscreen').
 *
 * Pattern: src/background/localAiClient.ts
 */

import { logError, ErrorCode } from '../utils/logger.js';
import { errorMessage } from '../utils/errorUtils.js';
import { pickDefined } from '../utils/objectUtils.js';
import { recordSqliteFailure, recordSqliteSuccess } from './sqliteAlert.js';
import type {
  SqliteRpcResult,
  SqliteRpcClient,
  QueryOp,
  MutateOp,
  MaintainOp,
  AuditLogRecord,
} from '../messaging/sqliteRpcClient.js';
import { categorizeError } from '../messaging/sqliteRpcClient.js';
import type { SqliteMessageType } from '../messaging/sqliteMessages.js';
import type {
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
  OffscreenHealthResponse,
} from '../messaging/sqliteMessages.js';
import type { OffscreenTransport } from './offscreenTransport.js';
import { ChromeOffscreenTransport } from './offscreenTransport.js';

import type { BrowsingLogRecord, StorageQuery } from '../utils/sqlite-types.js';
import type { OpfsSpikeReport } from '../offscreen/opfsSpike.js';

export type { SqliteRpcResult as CallResult, SqliteError } from '../messaging/sqliteRpcClient.js';
export { categorizeError } from '../messaging/sqliteRpcClient.js';

// ============================================================================
// SqliteClient
// ============================================================================

export class SqliteClient implements SqliteRpcClient {
  /**
   * Transport layer for sending messages to the offscreen document.
   * Injected for testing; defaults to ChromeOffscreenTransport in production.
   */
  private readonly transport: OffscreenTransport;

  constructor(transport?: OffscreenTransport) {
    this.transport = transport ?? new ChromeOffscreenTransport();
  }

  // --------------------------------------------------------------------------
  // domain-private helpers — each owns its OffscreenResponse subtype and error taxonomy
  // --------------------------------------------------------------------------

  private async callQuery<T, R extends OffscreenQueryResponse | OffscreenCountResponse = OffscreenQueryResponse | OffscreenCountResponse>(
    type: SqliteMessageType,
    payload: Record<string, unknown> = {},
    transform?: (res: Extract<R, { success: true }>) => T,
    traceId: string = '',
  ): Promise<SqliteRpcResult<T>> {
    try {
      const res = await this.transport.msgOffscreen(type, payload, traceId);
      if (!res?.success) {
        const msg = res && 'error' in res ? String(res.error) : `${type} failed`;
        recordSqliteFailure(type, msg);
        logError('SQLite Client: call failed', { error: msg, traceId }, ErrorCode.STORAGE_READ_FAILURE, 'sqlite');
        return { success: false, error: categorizeError(msg) };
      }
      recordSqliteSuccess();
      // WHY: offscreen document returns serialized data that TypeScript cannot structurally validate
      return { success: true, data: transform ? transform(res as Extract<R, { success: true }>) : (res as T) };
    } catch (error) {
      const msg = errorMessage(error);
      recordSqliteFailure(type, msg);
      logError('SQLite Client: call failed', { error: msg, traceId }, ErrorCode.STORAGE_READ_FAILURE, 'sqlite');
      return { success: false, error: categorizeError(msg) };
    }
  }

  private async callMutate<T, R extends OffscreenInsertResponse | OffscreenCountResponse | OffscreenWriteResponse | OffscreenToggleStarResponse = OffscreenInsertResponse | OffscreenCountResponse | OffscreenWriteResponse | OffscreenToggleStarResponse>(
    type: SqliteMessageType,
    payload: Record<string, unknown> = {},
    transform?: (res: Extract<R, { success: true }>) => T,
    traceId: string = '',
  ): Promise<SqliteRpcResult<T>> {
    try {
      const res = await this.transport.msgOffscreen(type, payload, traceId);
      if (!res?.success) {
        const msg = res && 'error' in res ? String(res.error) : `${type} failed`;
        recordSqliteFailure(type, msg);
        logError('SQLite Client: call failed', { error: msg, traceId }, ErrorCode.STORAGE_READ_FAILURE, 'sqlite');
        return { success: false, error: categorizeError(msg) };
      }
      recordSqliteSuccess();
      // WHY: offscreen document returns serialized data that TypeScript cannot structurally validate
      return { success: true, data: transform ? transform(res as Extract<R, { success: true }>) : (res as T) };
    } catch (error) {
      const msg = errorMessage(error);
      recordSqliteFailure(type, msg);
      logError('SQLite Client: call failed', { error: msg, traceId }, ErrorCode.STORAGE_READ_FAILURE, 'sqlite');
      return { success: false, error: categorizeError(msg) };
    }
  }

  private async callMaintain<T, R extends OffscreenBinaryResponse | OffscreenWriteResponse | OffscreenPurgeResponse | OffscreenContentPurgeResponse | OffscreenOpfsSpikeResponse | OffscreenHealthResponse = OffscreenBinaryResponse | OffscreenWriteResponse | OffscreenPurgeResponse | OffscreenContentPurgeResponse | OffscreenOpfsSpikeResponse | OffscreenHealthResponse>(
    type: SqliteMessageType,
    payload: Record<string, unknown> = {},
    transform?: (res: Extract<R, { success: true }>) => T,
    traceId: string = '',
  ): Promise<SqliteRpcResult<T>> {
    try {
      const res = await this.transport.msgOffscreen(type, payload, traceId);
      if (!res?.success) {
        const msg = res && 'error' in res ? String(res.error) : `${type} failed`;
        recordSqliteFailure(type, msg);
        logError('SQLite Client: call failed', { error: msg, traceId }, ErrorCode.STORAGE_READ_FAILURE, 'sqlite');
        return { success: false, error: categorizeError(msg) };
      }
      recordSqliteSuccess();
      // WHY: offscreen document returns serialized data that TypeScript cannot structurally validate
      return { success: true, data: transform ? transform(res as Extract<R, { success: true }>) : (res as T) };
    } catch (error) {
      const msg = errorMessage(error);
      recordSqliteFailure(type, msg);
      logError('SQLite Client: call failed', { error: msg, traceId }, ErrorCode.STORAGE_READ_FAILURE, 'sqlite');
      return { success: false, error: categorizeError(msg) };
    }
  }

  private async callStatus(
    payload: Record<string, unknown> = {},
    traceId: string = '',
  ): Promise<SqliteRpcResult<Omit<OffscreenStatusData, 'success'>>> {
    const type: SqliteMessageType = 'SQLITE_STATUS';
    try {
      const res = await this.transport.msgOffscreen(type, payload, traceId);
      if (!res?.success) {
        const msg = res && 'error' in res ? String(res.error) : `${type} failed`;
        recordSqliteFailure(type, msg);
        logError('SQLite Client: call failed', { error: msg, traceId }, ErrorCode.STORAGE_READ_FAILURE, 'sqlite');
        return { success: false, error: categorizeError(msg) };
      }
      recordSqliteSuccess();
      const r = res as Extract<OffscreenStatusResponse, { success: true }>;
      return {
        success: true,
        data: {
          initialized: r.initialized,
          path: r.path,
          fallback: r.fallback,
          ...pickDefined({
            fts5: r.fts5,
            initError: r.initError,
            compileOptions: r.compileOptions,
            compileOptionsSource: r.compileOptionsSource,
            opfsMigrationV2Done: r.opfsMigrationV2Done,
            opfsMigrationV2LastAttemptedAt: r.opfsMigrationV2LastAttemptedAt,
            opfsMigrationV2CompletedAt: r.opfsMigrationV2CompletedAt,
            opfsMigrationV2RecordCount: r.opfsMigrationV2RecordCount,
          }),
        },
      };
    } catch (error) {
      const msg = errorMessage(error);
      recordSqliteFailure(type, msg);
      logError('SQLite Client: call failed', { error: msg, traceId }, ErrorCode.STORAGE_READ_FAILURE, 'sqlite');
      return { success: false, error: categorizeError(msg) };
    }
  }

  // --------------------------------------------------------------------------
  // query domain — read path
  //
  // These return CallResult so the failure reason travels with the call that
  // produced it. (PBI-02 removed the `null`-returning wrappers that discarded
  // that reason.)
  // --------------------------------------------------------------------------

  async query(q?: StorageQuery): Promise<SqliteRpcResult<{ rows: BrowsingLogRecord[]; total: number }>>;
  async query(op: { kind: 'search'; text: string; limit?: number; offset?: number; orderBy?: 'rank' | 'created_at'; orderDir?: 'ASC' | 'DESC' }): Promise<SqliteRpcResult<{ rows: BrowsingLogRecord[]; total: number }>>;
  async query(op: { kind: 'count' }): Promise<SqliteRpcResult<number>>;
  async query(op: { kind: 'auditLog'; limit?: number; offset?: number }): Promise<SqliteRpcResult<{ rows: AuditLogRecord[]; total: number }>>;
  async query(op: QueryOp | StorageQuery = {}): Promise<SqliteRpcResult<unknown>> {
    if (isQueryOp(op)) {
      switch (op.kind) {
        case 'count':
          return this.callQuery<number, OffscreenCountResponse>('SQLITE_COUNT', {}, (res) => {
            if (!Number.isFinite(res.count)) {
              throw new Error('SQLite count response was missing a numeric count');
            }
            return res.count;
          });
        case 'auditLog':
          return this.callQuery<{ rows: AuditLogRecord[]; total: number }, OffscreenQueryResponse>(
            'SQLITE_AUDIT_LOG_QUERY',
            { limit: op.limit, offset: op.offset },
            (res) => ({
              rows: (res.rows || []) as AuditLogRecord[],
              total: res.total,
            }),
          );
        case 'search': {
          const q: StorageQuery = {
            text: op.text,
            ...pickDefined({ limit: op.limit, offset: op.offset, orderBy: op.orderBy, orderDir: op.orderDir }),
          };
          return this.queryRecords(q);
        }
        case 'records':
          return this.queryRecords(op.q ?? {});
        default: {
          const exhaustive: never = op;
          void exhaustive;
          throw new Error('Unhandled query op');
        }
      }
    }
    return this.queryRecords(op);
  }

  private async queryRecords(q: StorageQuery): Promise<SqliteRpcResult<{ rows: BrowsingLogRecord[]; total: number }>> {
    return this.callQuery<{ rows: BrowsingLogRecord[]; total: number }, OffscreenQueryResponse>(
      'SQLITE_QUERY',
      q as Record<string, unknown>,
      (res) => ({
        rows: (res.rows || []) as BrowsingLogRecord[],
        total: res.total,
      }),
    );
  }

  // --------------------------------------------------------------------------
  // mutate domain — write path
  // --------------------------------------------------------------------------

  async mutate(op: { type: 'insert'; record: BrowsingLogRecord; traceId?: string }): Promise<SqliteRpcResult<{ id: number }>>;
  async mutate(op: { type: 'insertBatch'; records: BrowsingLogRecord[] }): Promise<SqliteRpcResult<{ count: number }>>;
  async mutate(op: { type: 'update'; id: number; changes: Partial<Record<string, unknown>>; traceId?: string } | { type: 'delete'; id: number }): Promise<SqliteRpcResult<void>>;
  async mutate(op: { type: 'toggleStar'; id: number }): Promise<SqliteRpcResult<{ is_starred: number }>>;
  async mutate(op: { type: 'insertAuditLog'; record: Omit<AuditLogRecord, 'id'> }): Promise<SqliteRpcResult<{ id: number }>>;
  async mutate(op: MutateOp): Promise<SqliteRpcResult<unknown>> {
    switch (op.type) {
      case 'insert':
        return this.callMutate<{ id: number }, OffscreenInsertResponse>(
          'SQLITE_INSERT',
          // WHY: BrowsingLogRecord lacks index signature; must cast through unknown for offscreen payload
          op.record as unknown as Record<string, unknown>,
          (res) => ({ id: res.id }),
          op.traceId ?? '',
        );
      case 'insertBatch':
        return this.callMutate<{ count: number }, OffscreenCountResponse>(
          'SQLITE_INSERT_BATCH',
          // WHY: BrowsingLogRecord[] lacks index signature; must cast through unknown for offscreen payload
          { records: op.records as unknown as Record<string, unknown>[] },
          (res) => ({ count: res.count }),
        );
      case 'update':
        return this.callMutate<void, OffscreenWriteResponse>('SQLITE_UPDATE', { id: op.id, ...op.changes }, () => undefined, op.traceId ?? '');
      case 'delete':
        return this.callMutate<void, OffscreenWriteResponse>('SQLITE_DELETE', { id: op.id }, () => undefined);
      case 'toggleStar':
        return this.callMutate<{ is_starred: number }, OffscreenToggleStarResponse>(
          'SQLITE_TOGGLE_STAR',
          { id: op.id },
          (res) => ({ is_starred: res.is_starred }),
        );
      case 'insertAuditLog':
        return this.callMutate<{ id: number }, OffscreenInsertResponse>(
          'SQLITE_AUDIT_LOG_INSERT',
          op.record as unknown as Record<string, unknown>,
          (res) => ({ id: res.id }),
        );
      default: {
        const exhaustive: never = op;
        void exhaustive;
        throw new Error('Unhandled mutate op');
      }
    }
  }

  // --------------------------------------------------------------------------
  // maintain domain — lifecycle & maintenance operations
  // --------------------------------------------------------------------------

  async maintain(op: { type: 'init' }): Promise<SqliteRpcResult<boolean>>;
  async maintain(op: { type: 'backup' }): Promise<SqliteRpcResult<Uint8Array>>;
  async maintain(op: { type: 'restore'; data: Uint8Array } | { type: 'clearAll' }): Promise<SqliteRpcResult<void>>;
  async maintain(
    op: { type: 'purgeOldRecords'; retentionDays?: number; maxRecords?: number } | { type: 'purgeContent'; retentionDays?: number; maxRecords?: number; includeStarred?: boolean },
  ): Promise<SqliteRpcResult<{ purged: number }>>;
  async maintain(op: { type: 'opfsSpike' }): Promise<SqliteRpcResult<OpfsSpikeReport>>;
  async maintain(op: { type: 'healthCheck' }): Promise<SqliteRpcResult<boolean>>;
  async maintain(op: MaintainOp): Promise<SqliteRpcResult<unknown>> {
    switch (op.type) {
      case 'init': {
        const result = await this.callMaintain('SQLITE_INIT');
        return result.success ? { success: true, data: true } : result;
      }
      case 'backup':
        return this.callMaintain<Uint8Array, OffscreenBinaryResponse>('SQLITE_BACKUP', {}, (res) => new Uint8Array(res.data));
      case 'restore':
        return this.callMaintain<void, OffscreenWriteResponse>('SQLITE_RESTORE', { data: Array.from(op.data) }, () => undefined);
      case 'clearAll':
        return this.callMaintain<void, OffscreenWriteResponse>('SQLITE_CLEAR_ALL', {}, () => undefined);
      case 'purgeOldRecords':
        return this.callMaintain<{ purged: number }, OffscreenPurgeResponse>(
          'SQLITE_PURGE',
          { retentionDays: op.retentionDays, maxRecords: op.maxRecords },
          (res) => ({ purged: res.purged }),
        );
      case 'purgeContent':
        return this.callMaintain<{ purged: number }, OffscreenContentPurgeResponse>(
          'CONTENT_PURGE',
          { retentionDays: op.retentionDays, maxRecords: op.maxRecords, includeStarred: op.includeStarred },
          (res) => ({ purged: res.purged }),
        );
      case 'opfsSpike':
        return this.callMaintain<OpfsSpikeReport, OffscreenOpfsSpikeResponse>('SQLITE_OPFS_SPIKE', {}, (res) => res.report);
      case 'healthCheck': {
        const result = await this.callMaintain('SQLITE_HEALTH_CHECK', {});
        return result.success ? { success: true, data: true } : result;
      }
      default: {
        const exhaustive: never = op;
        void exhaustive;
        throw new Error('Unhandled maintain op');
      }
    }
  }

  async getStatus(): Promise<Omit<OffscreenStatusData, 'success'> | null> {
    const result = await this.callStatus();
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
    };
  }

}

/** Type guard distinguishing a domain QueryOp from a bare StorageQuery payload. */
function isQueryOp(op: QueryOp | StorageQuery): op is QueryOp {
  return typeof op === 'object' && op !== null && 'kind' in op;
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
