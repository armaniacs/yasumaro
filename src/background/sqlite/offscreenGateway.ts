// @layer 1 — OffscreenGateway (background → offscreen hop)
// Extracted from sqliteGateway.ts (390l) to give each hop its own locality (PBI 07).

import { logError, ErrorCode } from '../../utils/logger.js';
import { errorMessage } from '../../utils/errorUtils.js';
import { pickDefined } from '../../utils/objectUtils.js';
import { recordSqliteFailure, recordSqliteSuccess } from '../sqliteAlert.js';
import type { SqliteError, QueryOp, MutateOp, MaintainOp, AuditLogRecord } from '../../messaging/sqliteRpcClient.js';
import { categorizeError } from '../../messaging/sqliteRpcClient.js';
import type { SqliteMessageType } from '../../messaging/sqliteMessages.js';
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
} from '../../messaging/sqliteMessages.js';
import type { OffscreenTransport } from '../offscreenTransport.js';
import { ChromeOffscreenTransport } from '../offscreenTransport.js';
import type { BrowsingLogRecord, StorageQuery } from '../../utils/sqlite-types.js';
import type { OpfsSpikeReport } from '../../offscreen/opfsSpike.js';

export type SqliteResult<T> = { success: true; data: T } | { success: false; error: SqliteError };
export type { SqliteError };
export { categorizeError };

export class OffscreenGateway {
  private readonly transport: OffscreenTransport;
  constructor(transport?: OffscreenTransport) { this.transport = transport ?? new ChromeOffscreenTransport(); }

  private async callInternal<T, R = unknown>(type: SqliteMessageType, payload: Record<string, unknown> = {}, transform?: (res: Extract<R, { success: true }>) => T, traceId?: string): Promise<SqliteResult<T>> {
    try {
      const res = await this.transport.msgOffscreen(type, payload, traceId);
      if (!res?.success) {
        const msg = res && 'error' in res ? String(res.error) : `${type} failed`;
        recordSqliteFailure(type, msg);
        logError('SQLite Gateway: call failed', { error: msg, traceId }, ErrorCode.STORAGE_READ_FAILURE, 'sqlite');
        return { success: false, error: categorizeError(msg) };
      }
      recordSqliteSuccess();
      return { success: true, data: transform ? transform(res as Extract<R, { success: true }>) : (res as unknown as T) };
    } catch (error) {
      const msg = errorMessage(error);
      recordSqliteFailure(type, msg);
      logError('SQLite Gateway: call failed', { error: msg, traceId }, ErrorCode.STORAGE_READ_FAILURE, 'sqlite');
      return { success: false, error: categorizeError(msg) };
    }
  }

  async query(q?: StorageQuery): Promise<SqliteResult<{ rows: BrowsingLogRecord[]; total: number }>>;
  async query(op: Extract<QueryOp, { kind: 'search' }>): Promise<SqliteResult<{ rows: BrowsingLogRecord[]; total: number }>>;
  async query(op: Extract<QueryOp, { kind: 'count' }>): Promise<SqliteResult<number>>;
  async query(op: Extract<QueryOp, { kind: 'auditLog' }>): Promise<SqliteResult<{ rows: AuditLogRecord[]; total: number }>>;
  async query(op: QueryOp | StorageQuery = {}): Promise<SqliteResult<unknown>> {
    if (isQueryOp(op)) {
      switch (op.kind) {
        case 'count': return this.callInternal<number, OffscreenCountResponse>('SQLITE_COUNT', {}, (res) => { if (!Number.isFinite(res.count)) throw new Error('SQLite count response was missing a numeric count'); return res.count; });
        case 'auditLog': return this.callInternal<{ rows: AuditLogRecord[]; total: number }, OffscreenQueryResponse>('SQLITE_AUDIT_LOG_QUERY', { limit: op.limit, offset: op.offset }, (res) => ({ rows: (res.rows || []) as AuditLogRecord[], total: res.total }));
        case 'search': { const q: StorageQuery = { text: op.text, ...pickDefined({ limit: op.limit, offset: op.offset, orderBy: op.orderBy, orderDir: op.orderDir }) }; return this.queryRecords(q); }
        case 'records': return this.queryRecords(op.q ?? {});
        default: { const exhaustive: never = op; void exhaustive; throw new Error('Unhandled query op'); }
      }
    }
    return this.queryRecords(op);
  }

  private async queryRecords(q: StorageQuery): Promise<SqliteResult<{ rows: BrowsingLogRecord[]; total: number }>> {
    return this.callInternal<{ rows: BrowsingLogRecord[]; total: number }, OffscreenQueryResponse>('SQLITE_QUERY', q as Record<string, unknown>, (res) => ({ rows: (res.rows || []) as BrowsingLogRecord[], total: res.total }));
  }

  async mutate(op: Extract<MutateOp, { type: 'insert' }>): Promise<SqliteResult<{ id: number }>>;
  async mutate(op: Extract<MutateOp, { type: 'insertBatch' }>): Promise<SqliteResult<{ count: number }>>;
  async mutate(op: Extract<MutateOp, { type: 'update' }> | Extract<MutateOp, { type: 'delete' }>): Promise<SqliteResult<void>>;
  async mutate(op: Extract<MutateOp, { type: 'toggleStar' }>): Promise<SqliteResult<{ is_starred: number }>>;
  async mutate(op: Extract<MutateOp, { type: 'insertAuditLog' }>): Promise<SqliteResult<{ id: number }>>;
  async mutate(op: MutateOp): Promise<SqliteResult<unknown>> {
    switch (op.type) {
      case 'insert': return this.callInternal<{ id: number }, OffscreenInsertResponse>('SQLITE_INSERT', op.record as unknown as Record<string, unknown>, (res) => ({ id: res.id }), op.traceId);
      case 'insertBatch': return this.callInternal<{ count: number }, OffscreenCountResponse>('SQLITE_INSERT_BATCH', { records: op.records as unknown as Record<string, unknown>[] }, (res) => ({ count: res.count }));
      case 'update': return this.callInternal<void, OffscreenWriteResponse>('SQLITE_UPDATE', { id: op.id, ...op.changes }, () => undefined, op.traceId);
      case 'delete': return this.callInternal<void, OffscreenWriteResponse>('SQLITE_DELETE', { id: op.id }, () => undefined);
      case 'toggleStar': return this.callInternal<{ is_starred: number }, OffscreenToggleStarResponse>('SQLITE_TOGGLE_STAR', { id: op.id }, (res) => ({ is_starred: res.is_starred }));
      case 'insertAuditLog': return this.callInternal<{ id: number }, OffscreenInsertResponse>('SQLITE_AUDIT_LOG_INSERT', op.record as unknown as Record<string, unknown>, (res) => ({ id: res.id }));
      default: { const exhaustive: never = op; void exhaustive; throw new Error('Unhandled mutate op'); }
    }
  }

  async maintain(op: { type: 'init' }): Promise<SqliteResult<boolean>>;
  async maintain(op: { type: 'backup' }): Promise<SqliteResult<Uint8Array>>;
  async maintain(op: { type: 'restore'; data: Uint8Array } | { type: 'clearAll' }): Promise<SqliteResult<void>>;
  async maintain(op: { type: 'purgeOldRecords'; retentionDays?: number; maxRecords?: number } | { type: 'purgeContent'; retentionDays?: number; maxRecords?: number; includeStarred?: boolean }): Promise<SqliteResult<{ purged: number }>>;
  async maintain(op: { type: 'opfsSpike' }): Promise<SqliteResult<OpfsSpikeReport>>;
  async maintain(op: { type: 'healthCheck' }): Promise<SqliteResult<boolean>>;
  async maintain(op: MaintainOp): Promise<SqliteResult<unknown>> {
    switch (op.type) {
      case 'init': { const result = await this.callInternal<boolean, OffscreenHealthResponse>('SQLITE_INIT'); return result.success ? { success: true, data: true } : result; }
      case 'backup': return this.callInternal<Uint8Array, OffscreenBinaryResponse>('SQLITE_BACKUP', {}, (res) => new Uint8Array(res.data));
      case 'restore': return this.callInternal<void, OffscreenWriteResponse>('SQLITE_RESTORE', { data: Array.from(op.data) }, () => undefined);
      case 'clearAll': return this.callInternal<void, OffscreenWriteResponse>('SQLITE_CLEAR_ALL', {}, () => undefined);
      case 'purgeOldRecords': return this.callInternal<{ purged: number }, OffscreenPurgeResponse>('SQLITE_PURGE', { retentionDays: op.retentionDays, maxRecords: op.maxRecords }, (res) => ({ purged: res.purged }));
      case 'purgeContent': return this.callInternal<{ purged: number }, OffscreenContentPurgeResponse>('CONTENT_PURGE', { retentionDays: op.retentionDays, maxRecords: op.maxRecords, includeStarred: op.includeStarred }, (res) => ({ purged: res.purged }));
      case 'opfsSpike': return this.callInternal<OpfsSpikeReport, OffscreenOpfsSpikeResponse>('SQLITE_OPFS_SPIKE', {}, (res) => res.report);
      case 'healthCheck': { const result = await this.callInternal<boolean, OffscreenHealthResponse>('SQLITE_HEALTH_CHECK', {}); return result.success ? { success: true, data: true } : result; }
      default: { const exhaustive: never = op; void exhaustive; throw new Error('Unhandled maintain op'); }
    }
  }

  async status(): Promise<SqliteResult<Omit<OffscreenStatusData, 'success'>>> {
    const result = await this.callInternal<Omit<OffscreenStatusData, 'success'>, OffscreenStatusResponse>('SQLITE_STATUS', {}, (r) => ({ initialized: r.initialized, path: r.path, fallback: r.fallback, ...pickDefined({ fts5: r.fts5, initError: r.initError, compileOptions: r.compileOptions, compileOptionsSource: r.compileOptionsSource, opfsMigrationV2Done: r.opfsMigrationV2Done, opfsMigrationV2LastAttemptedAt: r.opfsMigrationV2LastAttemptedAt, opfsMigrationV2CompletedAt: r.opfsMigrationV2CompletedAt, opfsMigrationV2RecordCount: r.opfsMigrationV2RecordCount }) }));
    return result;
  }

  async getStatus(): Promise<Omit<OffscreenStatusData, 'success'> | null> {
    const result = await this.status();
    if (result.success) return result.data;
    return { initialized: false, path: '', fallback: false, fts5: false, initError: result.error.message || 'Unknown error' };
  }
}

function isQueryOp(op: QueryOp | StorageQuery): op is QueryOp { return typeof op === 'object' && op !== null && 'kind' in op; }

// Backward compat — keep both value and type for callers that use SqliteGateway as type
export const SqliteGateway = OffscreenGateway;
export type SqliteGateway = OffscreenGateway;
