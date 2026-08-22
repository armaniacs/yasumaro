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

  private async call<T, R extends OffscreenResponse = OffscreenResponse>(
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

  // --------------------------------------------------------------------------
  // query domain — read path
  //
  // These return CallResult so the failure reason travels with the call that
  // produced it. (PBI-02 removed the `null`-returning wrappers that discarded
  // that reason.)
  // --------------------------------------------------------------------------

  async query(q?: StorageQuery): Promise<SqliteRpcResult<{ rows: BrowsingLogRecord[]; total: number }>>;
  async query(op: Extract<QueryOp, { kind: 'search' }>): Promise<SqliteRpcResult<{ rows: BrowsingLogRecord[]; total: number }>>;
  async query(op: Extract<QueryOp, { kind: 'count' }>): Promise<SqliteRpcResult<number>>;
  async query(op: Extract<QueryOp, { kind: 'auditLog' }>): Promise<SqliteRpcResult<{ rows: AuditLogRecord[]; total: number }>>;
  async query(op: QueryOp | StorageQuery = {}): Promise<SqliteRpcResult<unknown>> {
    if (isQueryOp(op)) {
      switch (op.kind) {
        case 'count':
          return this.call<number, OffscreenCountResponse>('SQLITE_COUNT', {}, (res) => {
            if (!Number.isFinite(res.count)) {
              throw new Error('SQLite count response was missing a numeric count');
            }
            return res.count;
          });
        case 'auditLog':
          return this.call<{ rows: AuditLogRecord[]; total: number }, OffscreenQueryResponse>(
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
    return this.call<{ rows: BrowsingLogRecord[]; total: number }, OffscreenQueryResponse>(
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

  async mutate(op: Extract<MutateOp, { type: 'insert' }>): Promise<SqliteRpcResult<{ id: number }>>;
  async mutate(op: Extract<MutateOp, { type: 'insertBatch' }>): Promise<SqliteRpcResult<{ count: number }>>;
  async mutate(op: Extract<MutateOp, { type: 'update' }> | Extract<MutateOp, { type: 'delete' }>): Promise<SqliteRpcResult<void>>;
  async mutate(op: Extract<MutateOp, { type: 'toggleStar' }>): Promise<SqliteRpcResult<{ is_starred: number }>>;
  async mutate(op: Extract<MutateOp, { type: 'insertAuditLog' }>): Promise<SqliteRpcResult<{ id: number }>>;
  async mutate(op: MutateOp): Promise<SqliteRpcResult<unknown>> {
    switch (op.type) {
      case 'insert':
        return this.call<{ id: number }, OffscreenInsertResponse>(
          'SQLITE_INSERT',
          // WHY: BrowsingLogRecord lacks index signature; must cast through unknown for offscreen payload
          op.record as unknown as Record<string, unknown>,
          (res) => ({ id: res.id }),
          op.traceId ?? '',
        );
      case 'insertBatch':
        return this.call<{ count: number }, OffscreenCountResponse>(
          'SQLITE_INSERT_BATCH',
          // WHY: BrowsingLogRecord[] lacks index signature; must cast through unknown for offscreen payload
          { records: op.records as unknown as Record<string, unknown>[] },
          (res) => ({ count: res.count }),
        );
      case 'update':
        return this.call<void, OffscreenWriteResponse>('SQLITE_UPDATE', { id: op.id, ...op.changes }, () => undefined, op.traceId ?? '');
      case 'delete':
        return this.call<void, OffscreenWriteResponse>('SQLITE_DELETE', { id: op.id }, () => undefined);
      case 'toggleStar':
        return this.call<{ is_starred: number }, OffscreenToggleStarResponse>(
          'SQLITE_TOGGLE_STAR',
          { id: op.id },
          (res) => ({ is_starred: res.is_starred }),
        );
      case 'insertAuditLog':
        return this.call<{ id: number }, OffscreenInsertResponse>(
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

  async maintain(op: Extract<MaintainOp, { type: 'init' }>): Promise<SqliteRpcResult<boolean>>;
  async maintain(op: Extract<MaintainOp, { type: 'backup' }>): Promise<SqliteRpcResult<Uint8Array>>;
  async maintain(op: Extract<MaintainOp, { type: 'restore' }> | Extract<MaintainOp, { type: 'clearAll' }>): Promise<SqliteRpcResult<void>>;
  async maintain(
    op: Extract<MaintainOp, { type: 'purgeOldRecords' }> | Extract<MaintainOp, { type: 'purgeContent' }>,
  ): Promise<SqliteRpcResult<{ purged: number }>>;
  async maintain(op: Extract<MaintainOp, { type: 'opfsSpike' }>): Promise<SqliteRpcResult<OpfsSpikeReport>>;
  async maintain(op: Extract<MaintainOp, { type: 'healthCheck' }>): Promise<SqliteRpcResult<boolean>>;
  async maintain(op: MaintainOp): Promise<SqliteRpcResult<unknown>> {
    switch (op.type) {
      case 'init': {
        const result = await this.call('SQLITE_INIT');
        return result.success ? { success: true, data: true } : result;
      }
      case 'backup':
        return this.call<Uint8Array, OffscreenBinaryResponse>('SQLITE_BACKUP', {}, (res) => new Uint8Array(res.data));
      case 'restore':
        return this.call<void, OffscreenWriteResponse>('SQLITE_RESTORE', { data: Array.from(op.data) }, () => undefined);
      case 'clearAll':
        return this.call<void, OffscreenWriteResponse>('SQLITE_CLEAR_ALL', {}, () => undefined);
      case 'purgeOldRecords':
        return this.call<{ purged: number }, OffscreenPurgeResponse>(
          'SQLITE_PURGE',
          { retentionDays: op.retentionDays, maxRecords: op.maxRecords },
          (res) => ({ purged: res.purged }),
        );
      case 'purgeContent':
        return this.call<{ purged: number }, OffscreenContentPurgeResponse>(
          'CONTENT_PURGE',
          { retentionDays: op.retentionDays, maxRecords: op.maxRecords, includeStarred: op.includeStarred },
          (res) => ({ purged: res.purged }),
        );
      case 'opfsSpike':
        return this.call<OpfsSpikeReport, OffscreenOpfsSpikeResponse>('SQLITE_OPFS_SPIKE', {}, (res) => res.report);
      case 'healthCheck': {
        const result = await this.call('SQLITE_HEALTH_CHECK', {});
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
    const result = await this.call<Omit<OffscreenStatusData, 'success'>, OffscreenStatusResponse>(
      'SQLITE_STATUS',
      {},
      (res) => ({
        initialized: res.initialized,
        path: res.path,
        fallback: res.fallback,
        ...pickDefined({
          fts5: res.fts5,
          initError: res.initError,
          compileOptions: res.compileOptions,
          compileOptionsSource: res.compileOptionsSource,
          opfsMigrationV2Done: res.opfsMigrationV2Done,
          opfsMigrationV2LastAttemptedAt: res.opfsMigrationV2LastAttemptedAt,
          opfsMigrationV2CompletedAt: res.opfsMigrationV2CompletedAt,
          opfsMigrationV2RecordCount: res.opfsMigrationV2RecordCount,
        }),
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
    };
  }

  /* Backward-compatible wrappers for the old 20-method interface.
   * These are temporary and will be removed once all consumers are updated.
   */
  async init(): Promise<SqliteRpcResult<boolean>> {
    const result = await this.maintain({ type: 'init' });
    return result.success ? { success: true, data: true } : result;
  }

  async insertResult(record: BrowsingLogRecord, traceId: string = ''): Promise<SqliteRpcResult<{ id: number }>> {
    return this.mutate({ type: 'insert', record, traceId });
  }

  async insertBatchResult(records: BrowsingLogRecord[]): Promise<SqliteRpcResult<{ count: number }>> {
    return this.mutate({ type: 'insertBatch', records });
  }

  async queryResult<T = BrowsingLogRecord>(q: StorageQuery = {}): Promise<SqliteRpcResult<{ rows: T[]; total: number }>> {
    const result = await this.query(q);
    if (!result.success) return result;
    // @ts-ignore: We are trusting that the caller's T matches the actual row type.
    return { success: true, data: { rows: result.data.rows as T[], total: result.data.total } };
  }

  async searchResult(
    searchQuery: string,
    limit = 50,
    offset = 0,
    options: { orderBy?: 'rank' | 'created_at'; orderDir?: 'ASC' | 'DESC' } = {}
  ): Promise<SqliteRpcResult<{ rows: BrowsingLogRecord[]; total: number }>> {
    return this.query({
      text: searchQuery,
      limit,
      offset,
      ...pickDefined({ orderBy: options.orderBy, orderDir: options.orderDir }),
    });
  }

  async updateResult(id: number, changes: Partial<Record<string, unknown>>, traceId: string = ''): Promise<SqliteRpcResult<void>> {
    return this.mutate({ type: 'update', id, changes, traceId });
  }

  async deleteResult(id: number): Promise<SqliteRpcResult<void>> {
    return this.mutate({ type: 'delete', id });
  }

  async toggleStarResult(id: number): Promise<SqliteRpcResult<{ is_starred: number }>> {
    return this.mutate({ type: 'toggleStar', id });
  }

  async getCountResult(): Promise<SqliteRpcResult<number>> {
    return this.query({ kind: 'count' });
  }

  async backupDbResult(): Promise<SqliteRpcResult<Uint8Array>> {
    return this.maintain({ type: 'backup' });
  }

  async restoreDbResult(data: Uint8Array): Promise<SqliteRpcResult<void>> {
    return this.maintain({ type: 'restore', data });
  }

  async clearAllResult(): Promise<SqliteRpcResult<void>> {
    return this.maintain({ type: 'clearAll' });
  }

  async isSqliteHealthy(): Promise<boolean> {
    const result = await this.maintain({ type: 'healthCheck' });
    return result.success;
  }

  async runOpfsSpikeResult(): Promise<SqliteRpcResult<OpfsSpikeReport>> {
    return this.maintain({ type: 'opfsSpike' });
  }

  async purgeOldRecordsResult(retentionDays?: number, maxRecords?: number): Promise<SqliteRpcResult<{ purged: number }>> {
    return this.maintain({
      type: 'purgeOldRecords',
      ...pickDefined({ retentionDays, maxRecords }),
    });
  }

  async purgeContentResult(
    retentionDays?: number,
    maxRecords?: number,
    includeStarred?: boolean,
  ): Promise<SqliteRpcResult<{ purged: number }>> {
    return this.maintain({
      type: 'purgeContent',
      ...pickDefined({ retentionDays, maxRecords, includeStarred }),
    });
  }

  async insertAuditLogResult(record: { provider: string; url: string; created_at: number }): Promise<SqliteRpcResult<{ id: number }>> {
    return this.mutate({ type: 'insertAuditLog', record });
  }

  async queryAuditLogResult(options: { limit?: number; offset?: number } = {}): Promise<SqliteRpcResult<{ rows: Array<{ id: number; provider: string; url: string; created_at: number }>; total: number }>> {
    const result = await this.query({
      kind: 'auditLog',
      ...pickDefined({ limit: options.limit, offset: options.offset }),
    });
    if (!result.success) return result;
    // @ts-ignore: The types are compatible.
    return { success: true, data: { rows: result.data.rows as Array<{ id: number; provider: string; url: string; created_at: number }>, total: result.data.total } };
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
