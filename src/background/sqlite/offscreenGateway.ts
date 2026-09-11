// @layer 1 — OffscreenGateway (background → offscreen hop)
// Extracted from sqliteGateway.ts (390l) to give each hop its own locality (PBI 07).

import { logError, ErrorCode } from '../../utils/logger.js';
import { errorMessage } from '../../utils/errorUtils.js';
import { pickDefined } from '../../utils/objectUtils.js';
import { recordSqliteFailure, recordSqliteSuccess } from '../sqliteAlert.js';
import type { SqliteError, QueryOp, MutateOp, MaintainOp, AuditLogRecord, SqliteRpcClient, SqliteRpcResult } from '../../messaging/sqliteRpcClient.js';
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
  OffscreenWriteResponse,
  OffscreenHealthResponse,
  OffscreenArchivePreviewResponse,
  OffscreenArchiveCreateResponse,
  OffscreenArchiveCleanupResponse,
  OffscreenArchiveExportResponse,
  OffscreenArchivePrepareIncomingResponse,
  OffscreenArchiveRestorePreviewResponse,
  OffscreenArchiveRestoreResponse,
  OffscreenArchivePurgeResponse,
  OffscreenArchiveQueryResponse,
  OffscreenArchiveUpdateResponse,
  OffscreenArchiveSaveResponse,
  OffscreenArchiveCloseResponse,
  OffscreenArchiveStatusResponse,
  ArchiveSessionRow,
  ArchiveSessionStatusData,
  ArchivePurgeData,
  ArchivePreviewData,
  ArchiveCreateData,
  ArchiveExportData,
  ArchiveRestorePreviewData,
  ArchiveRestoreData,
} from '../../messaging/sqliteMessages.js';
import type { OffscreenTransport } from '../offscreenTransport.js';
import { ChromeOffscreenTransport } from '../offscreenTransport.js';
import type { BrowsingLogRecord, StorageQuery } from '../../utils/sqlite-types.js';
import { archiveWireFor, archiveNoRetry, isArchiveOpType, type ArchiveOpType } from '../../messaging/archiveWireTable.js';

export type SqliteResult<T> = { success: true; data: T } | { success: false; error: SqliteError };
export type { SqliteError };
export { categorizeError };

type GatewaySuccessResponse = { success: true } & Record<string, unknown>;

/**
 * Per-op success-response decoders for the table-driven archive path.
 * Each entry mirrors the transform the hand-written switch case used to
 * pass to callInternal; field access is checked against the wire response
 * type so a shape change fails compilation here instead of silently
 * returning undefined.
 */
const ARCHIVE_GATEWAY_DECODERS: Record<ArchiveOpType, (res: GatewaySuccessResponse) => unknown> = {
  archivePreview: (res) => (res as unknown as OffscreenArchivePreviewResponse & { success: true }).preview,
  archiveCreate: (res) => {
    const r = res as unknown as OffscreenArchiveCreateResponse & { success: true };
    return { stagingName: r.stagingName, recordCount: r.recordCount };
  },
  archiveCleanup: (res) => ({ removed: (res as unknown as OffscreenArchiveCleanupResponse & { success: true }).removed }),
  archiveExport: (res) => {
    const r = res as unknown as OffscreenArchiveExportResponse & { success: true };
    return { chunk: r.chunk, nextOffset: r.nextOffset, total: r.total, done: r.done };
  },
  archivePrepareIncoming: (res) => (res as unknown as OffscreenArchivePrepareIncomingResponse & { success: true }).stagingName,
  archiveRestorePreview: (res) => (res as unknown as OffscreenArchiveRestorePreviewResponse & { success: true }).preview,
  archiveRestore: (res) => {
    const r = res as unknown as OffscreenArchiveRestoreResponse & { success: true };
    return { restored: r.restored, restoredDeleted: r.restoredDeleted, skipped: r.skipped, skippedInvalid: r.skippedInvalid };
  },
  archiveDeleteByStaging: (res) => {
    const r = res as unknown as OffscreenArchivePurgeResponse & { success: true };
    return { deleted: r.deleted, remaining: r.remaining, freelistBefore: r.freelistBefore, freelistAfter: r.freelistAfter, vacuumOk: r.vacuumOk };
  },
  archiveOpen: () => undefined,
  archiveQuery: (res) => {
    const r = res as unknown as OffscreenArchiveQueryResponse & { success: true };
    return { rows: r.rows, total: r.total };
  },
  archiveUpdate: (res) => ({ dirty: (res as unknown as OffscreenArchiveUpdateResponse & { success: true }).dirty }),
  archiveSave: (res) => ({ dirty: (res as unknown as OffscreenArchiveSaveResponse & { success: true }).dirty }),
  archiveClose: (res) => ({ dirty: (res as unknown as OffscreenArchiveCloseResponse & { success: true }).dirty }),
  archiveStatus: (res) => (res as unknown as OffscreenArchiveStatusResponse & { success: true }).status,
};

export class OffscreenGateway {
  private readonly transport: OffscreenTransport;
  constructor(transport?: OffscreenTransport) { this.transport = transport ?? new ChromeOffscreenTransport(); }

  private async callInternal<T, R = unknown>(type: SqliteMessageType, payload: Record<string, unknown> = {}, transform?: (res: Extract<R, { success: true }>) => T, traceId?: string, transportOpts?: { noRetry?: boolean }): Promise<SqliteResult<T>> {
    try {
      const res = await this.transport.msgOffscreen(type, payload, traceId, transportOpts);
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
  async mutate(op: Extract<MutateOp, { type: 'insertBatch' }>): Promise<SqliteResult<{ count: number; skipped: number }>>;
  async mutate(op: Extract<MutateOp, { type: 'update' }> | Extract<MutateOp, { type: 'delete' }>): Promise<SqliteResult<void>>;
  async mutate(op: Extract<MutateOp, { type: 'toggleStar' }>): Promise<SqliteResult<{ is_starred: number }>>;
  async mutate(op: Extract<MutateOp, { type: 'insertAuditLog' }>): Promise<SqliteResult<{ id: number }>>;
  async mutate(op: MutateOp): Promise<SqliteResult<unknown>> {
    switch (op.type) {
      case 'insert': return this.callInternal<{ id: number }, OffscreenInsertResponse>('SQLITE_INSERT', op.record as unknown as Record<string, unknown>, (res) => ({ id: res.id }), op.traceId);
      case 'insertBatch': return this.callInternal<{ count: number; inserted?: number; skipped?: number }, OffscreenCountResponse>('SQLITE_INSERT_BATCH', { records: op.records as unknown as Record<string, unknown>[] }, (res) => ({ count: res.inserted ?? res.count, skipped: res.skipped ?? 0 }));
      /**
       * Flattened wire contract: changes travel as `{ id, ...changes }`,
       * not nested under a `changes` key. The offscreen update handler
       * reads flat keys via `key in payload`, so a nested shape would
       * silently apply zero columns instead of failing.
       */
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
  async maintain(op: { type: 'healthCheck' }): Promise<SqliteResult<boolean>>;
  async maintain(op: { type: 'archivePreview'; cutoffDate: string; cutoffMs: number; includeDeleted: boolean }): Promise<SqliteResult<ArchivePreviewData>>;
  async maintain(op: { type: 'archiveCreate'; cutoffDate: string; cutoffMs: number; includeDeleted: boolean; yasumaroVersion: string }): Promise<SqliteResult<ArchiveCreateData>>;
  async maintain(op: { type: 'archiveCleanup' }): Promise<SqliteResult<{ removed: string[] }>>;
  async maintain(op: { type: 'archiveExport'; stagingName: string; offset: number; length: number }): Promise<SqliteResult<ArchiveExportData>>;
  async maintain(op: { type: 'archivePrepareIncoming' }): Promise<SqliteResult<string>>;
  async maintain(op: { type: 'archiveRestorePreview'; stagingName: string }): Promise<SqliteResult<ArchiveRestorePreviewData>>;
  async maintain(op: { type: 'archiveRestore'; stagingName: string }): Promise<SqliteResult<ArchiveRestoreData>>;
  async maintain(op: { type: 'archiveDeleteByStaging'; stagingName: string }): Promise<SqliteResult<ArchivePurgeData>>;
  async maintain(op: { type: 'archiveOpen'; stagingName: string }): Promise<SqliteResult<void>>;
  async maintain(op: { type: 'archiveQuery'; stagingName: string; query: string; limit: number; offset: number }): Promise<SqliteResult<{ rows: ArchiveSessionRow[]; total: number }>>;
  async maintain(op: { type: 'archiveUpdate'; stagingName: string; id: number; changes: Record<string, unknown> }): Promise<SqliteResult<{ dirty: boolean }>>;
  async maintain(op: { type: 'archiveSave'; stagingName: string }): Promise<SqliteResult<{ dirty: boolean }>>;
  async maintain(op: { type: 'archiveClose'; stagingName: string }): Promise<SqliteResult<{ dirty: boolean }>>;
  async maintain(op: { type: 'archiveStatus' }): Promise<SqliteResult<ArchiveSessionStatusData>>;
  async maintain(op: MaintainOp): Promise<SqliteResult<unknown>> {
    // Archive ops (PBI 2026-09-07-22): routed through ARCHIVE_WIRE_TABLE.
    // The op object minus its discriminator is the wire payload; the table
    // supplies the message type, the response decoder, and the noRetry flag
    // (bulk/state-changing ops where a timeout does not mean failure, so a
    // blind retry would double-execute).
    if (isArchiveOpType(op.type)) {
      const entry = archiveWireFor(op.type);
      if (!entry) throw new Error(`Unhandled maintain op: ${op.type}`);
      const { type: _discriminator, ...payload } = op as unknown as Record<string, unknown>;
      const decode = ARCHIVE_GATEWAY_DECODERS[op.type];
      return this.callInternal<unknown>(
        entry.messageType,
        payload,
        decode,
        undefined,
        archiveNoRetry(op.type) ? { noRetry: true } : undefined,
      );
    }
    // Archive ops return above, so the switch below only sees the
    // non-archive remainder; the cast makes that explicit to the checker.
    const rest = op as Exclude<MaintainOp, { type: ArchiveOpType }>;
    switch (rest.type) {
      case 'init': { const result = await this.callInternal<boolean, OffscreenHealthResponse>('SQLITE_INIT'); return result.success ? { success: true, data: true } : result; }
      case 'backup': return this.callInternal<Uint8Array, OffscreenBinaryResponse>('SQLITE_BACKUP', {}, (res) => new Uint8Array(res.data));
      case 'restore': return this.callInternal<void, OffscreenWriteResponse>('SQLITE_RESTORE', { data: Array.from(rest.data) }, () => undefined);
      case 'clearAll': return this.callInternal<void, OffscreenWriteResponse>('SQLITE_CLEAR_ALL', {}, () => undefined);
      case 'purgeOldRecords': return this.callInternal<{ purged: number }, OffscreenPurgeResponse>('SQLITE_PURGE', { retentionDays: rest.retentionDays, maxRecords: rest.maxRecords }, (res) => ({ purged: res.purged }));
      case 'purgeContent': return this.callInternal<{ purged: number }, OffscreenContentPurgeResponse>('CONTENT_PURGE', { retentionDays: rest.retentionDays, maxRecords: rest.maxRecords, includeStarred: rest.includeStarred }, (res) => ({ purged: res.purged }));
      case 'healthCheck': { const result = await this.callInternal<boolean, OffscreenHealthResponse>('SQLITE_HEALTH_CHECK', {}); return result.success ? { success: true, data: true } : result; }
      default: { const exhaustive: never = rest; void exhaustive; throw new Error('Unhandled maintain op'); }
    }
  }

  async status(): Promise<SqliteResult<Omit<OffscreenStatusData, 'success'>>> {
    // PBI 2026-09-11-06: the extras pick must cover every enrichment field the
    // offscreen handler sends. idbMigrationV2Done / opfsLegacyDbPath /
    // idbLegacyDbName were silently dropped here, so the dashboard never saw
    // the IDB migration state or the legacy-DB probes (panel showed
    // "Not applicable" unconditionally).
    const result = await this.callInternal<Omit<OffscreenStatusData, 'success'>, OffscreenStatusResponse>('SQLITE_STATUS', {}, (r) => ({ initialized: r.initialized, path: r.path, fallback: r.fallback, ...pickDefined({ fts5: r.fts5, initError: r.initError, compileOptions: r.compileOptions, compileOptionsSource: r.compileOptionsSource, opfsMigrationV2Done: r.opfsMigrationV2Done, opfsMigrationV2LastAttemptedAt: r.opfsMigrationV2LastAttemptedAt, opfsMigrationV2CompletedAt: r.opfsMigrationV2CompletedAt, opfsMigrationV2RecordCount: r.opfsMigrationV2RecordCount, idbMigrationV2Done: r.idbMigrationV2Done, opfsLegacyDbPath: r.opfsLegacyDbPath, idbLegacyDbName: r.idbLegacyDbName }) }));
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

export type { SqliteRpcResult as CallResult } from '../../messaging/sqliteRpcClient.js';

export class SqliteClient implements SqliteRpcClient {
  private readonly gateway: OffscreenGateway;
  constructor(transport?: OffscreenTransport) { this.gateway = new OffscreenGateway(transport); }
  async query(q?: StorageQuery): Promise<SqliteRpcResult<{ rows: BrowsingLogRecord[]; total: number }>>;
  async query(op: Extract<QueryOp, { kind: 'search' }>): Promise<SqliteRpcResult<{ rows: BrowsingLogRecord[]; total: number }>>;
  async query(op: Extract<QueryOp, { kind: 'count' }>): Promise<SqliteRpcResult<number>>;
  async query(op: Extract<QueryOp, { kind: 'auditLog' }>): Promise<SqliteRpcResult<{ rows: AuditLogRecord[]; total: number }>>;
  async query(op: QueryOp | StorageQuery = {}): Promise<SqliteRpcResult<unknown>> { return this.gateway.query(op as QueryOp & StorageQuery) as Promise<SqliteRpcResult<unknown>>; }
  async mutate(op: Extract<MutateOp, { type: 'insert' }>): Promise<SqliteRpcResult<{ id: number }>>;
  async mutate(op: Extract<MutateOp, { type: 'insertBatch' }>): Promise<SqliteRpcResult<{ count: number; skipped: number }>>;
  async mutate(op: Extract<MutateOp, { type: 'update' }> | Extract<MutateOp, { type: 'delete' }>): Promise<SqliteRpcResult<void>>;
  async mutate(op: Extract<MutateOp, { type: 'toggleStar' }>): Promise<SqliteRpcResult<{ is_starred: number }>>;
  async mutate(op: Extract<MutateOp, { type: 'insertAuditLog' }>): Promise<SqliteRpcResult<{ id: number }>>;
  async mutate(op: MutateOp): Promise<SqliteRpcResult<unknown>> { const mutate = this.gateway.mutate.bind(this.gateway) as (op: MutateOp) => Promise<SqliteRpcResult<unknown>>; return mutate(op); }
  async maintain(op: { type: 'init' }): Promise<SqliteRpcResult<boolean>>;
  async maintain(op: { type: 'backup' }): Promise<SqliteRpcResult<Uint8Array>>;
  async maintain(op: { type: 'restore'; data: Uint8Array } | { type: 'clearAll' }): Promise<SqliteRpcResult<void>>;
  async maintain(op: { type: 'purgeOldRecords'; retentionDays?: number; maxRecords?: number } | { type: 'purgeContent'; retentionDays?: number; maxRecords?: number; includeStarred?: boolean }): Promise<SqliteRpcResult<{ purged: number }>>;
  async maintain(op: { type: 'healthCheck' }): Promise<SqliteRpcResult<boolean>>;
  async maintain(op: { type: 'archivePreview'; cutoffDate: string; cutoffMs: number; includeDeleted: boolean }): Promise<SqliteRpcResult<ArchivePreviewData>>;
  async maintain(op: { type: 'archiveCreate'; cutoffDate: string; cutoffMs: number; includeDeleted: boolean; yasumaroVersion: string }): Promise<SqliteRpcResult<ArchiveCreateData>>;
  async maintain(op: { type: 'archiveCleanup' }): Promise<SqliteRpcResult<{ removed: string[] }>>;
  async maintain(op: { type: 'archiveExport'; stagingName: string; offset: number; length: number }): Promise<SqliteRpcResult<ArchiveExportData>>;
  async maintain(op: { type: 'archivePrepareIncoming' }): Promise<SqliteRpcResult<string>>;
  async maintain(op: { type: 'archiveRestorePreview'; stagingName: string }): Promise<SqliteRpcResult<ArchiveRestorePreviewData>>;
  async maintain(op: { type: 'archiveRestore'; stagingName: string }): Promise<SqliteRpcResult<ArchiveRestoreData>>;
  async maintain(op: { type: 'archiveDeleteByStaging'; stagingName: string }): Promise<SqliteRpcResult<ArchivePurgeData>>;
  async maintain(op: { type: 'archiveOpen'; stagingName: string }): Promise<SqliteRpcResult<void>>;
  async maintain(op: { type: 'archiveQuery'; stagingName: string; query: string; limit: number; offset: number }): Promise<SqliteRpcResult<{ rows: ArchiveSessionRow[]; total: number }>>;
  async maintain(op: { type: 'archiveUpdate'; stagingName: string; id: number; changes: Record<string, unknown> }): Promise<SqliteRpcResult<{ dirty: boolean }>>;
  async maintain(op: { type: 'archiveSave'; stagingName: string }): Promise<SqliteRpcResult<{ dirty: boolean }>>;
  async maintain(op: { type: 'archiveClose'; stagingName: string }): Promise<SqliteRpcResult<{ dirty: boolean }>>;
  async maintain(op: { type: 'archiveStatus' }): Promise<SqliteRpcResult<ArchiveSessionStatusData>>;
  async maintain(op: MaintainOp): Promise<SqliteRpcResult<unknown>> { const maintain = this.gateway.maintain.bind(this.gateway) as (op: MaintainOp) => Promise<SqliteRpcResult<unknown>>; return maintain(op); }
  async getStatus(): Promise<Omit<OffscreenStatusData, 'success'> | null> { return this.gateway.getStatus(); }
  async status(): Promise<SqliteResult<Omit<OffscreenStatusData, 'success'>>> { return this.gateway.status(); }
}

let sharedInstance: SqliteClient | null = null;
export function getSharedSqliteClient(): SqliteClient { if (!sharedInstance) sharedInstance = new SqliteClient(); return sharedInstance; }
